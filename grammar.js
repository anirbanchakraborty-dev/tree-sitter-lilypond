/**
 * @file LilyPond grammar for Tree-sitter, with embedded Scheme in the same tree
 * @author Anirban Chakraborty
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// A letter, as LilyPond's lexer counts one: an ASCII letter or any character
// outside ASCII. The class excludes every other ASCII character, so it keeps
// Bengali and every other script, including characters beyond the BMP. It
// also excludes the byte-order mark, which LilyPond skips as whitespace.
const LETTER = '[^\\x00-\\x40\\x5B-\\x60\\x7B-\\x7F\\uFEFF]';

// A word: letters, with a single `-` or `_` allowed between two letters and no
// digits, so `\foo2` is the command `\foo` followed by the number 2.
const WORD = `${LETTER}(?:[-_]?${LETTER})*`;

// The characters that end a Scheme symbol. Everything else belongs to one,
// including `{`, `}` and `%`, so `#red}` is the single symbol `red}`.
const SCHEME_DELIMITER = '\\s()";\'`,';

// A Scheme symbol, which cannot begin with `#` (that starts hash syntax) and is
// never a lone `.` (that marks a dotted pair). `firstExcluded` names further
// characters the symbol may not begin with.
const schemeSymbol = (firstExcluded) => new RegExp(
  `[^${SCHEME_DELIMITER}#.${firstExcluded}][^${SCHEME_DELIMITER}]*` +
  `|\\.[^${SCHEME_DELIMITER}]+`,
);

// A markup command. Inside markup `\override` takes a Scheme pair and is a
// command like any other, although it is a keyword everywhere else.
const markupCommand = ($) => choice($.command, alias('\\override', $.command));

// Markup commands and their Scheme arguments, then an argument, which may be
// left out after a command.
const markupContent = ($, argument) => choice(
  seq(repeat1(choice(markupCommand($), $.scheme)), optional(argument)),
  argument,
);

// A metronome mark: a unit, `=` and a rate, or a range of rates.
const metronomeMark = ($) => seq(
  field('unit', $.duration),
  '=',
  field('bpm', $.number),
  optional(seq('-', field('bpm', $.number))),
);

// What follows the direction of an articulation: a shorthand or a command.
const articulationMark = ($) => choice('.', '-', '^', '>', '_', '!', '+', $.command);

// Ties, slurs, beams, ligatures and hairpins, each with its text. Any of them
// may follow a direction, as in `c^(`, and none needs one.
const SPANNERS = {
  tie: '~',
  slur_start: '(',
  slur_end: ')',
  phrasing_slur_start: '\\(',
  phrasing_slur_end: '\\)',
  beam_start: '[',
  beam_end: ']',
  ligature_start: '\\[',
  ligature_end: '\\]',
  hairpin: choice('\\<', '\\>'),
  hairpin_end: '\\!',
};

// The spanners figure mode keeps, since it reads `[`, `]` and `\!` as parts
// of a figure.
const FIGURE_SPANNERS = Object.keys(SPANNERS).filter(
  (name) => !['beam_start', 'beam_end', 'hairpin_end'].includes(name),
);

// A rule for each spanner named, called `prefix` and the spanner's name, that
// takes a direction before it or none. `direction` gives the directions
// allowed, from `$`.
const spannerRules = (prefix, direction, names) => Object.fromEntries(names.map(
  (name) => [prefix + name, $ => seq(optional(direction($)), SPANNERS[name])],
));

// The post-events that take a direction, in a mode that allows only some of
// the directions: the spanners named, and the articulation, fingering and
// text script. Each is a hidden rule of its own, `_chord_articulation` and so
// on, because an alias of a bare sequence would name each of its parts.
const directedPostEvents = ($, mode, spanners = Object.keys(SPANNERS)) => [
  ...spanners.map((name) => alias($[`_${mode}_${name}`], $[name])),
  alias($[`_${mode}_articulation`], $.articulation),
  alias($[`_${mode}_fingering`], $.fingering),
  alias($[`_${mode}_text_script`], $.text_script),
];

// The rules `directedPostEvents` names, for one mode and its directions.
const directedPostEventRules = (mode, direction, spanners = Object.keys(SPANNERS)) => ({
  ...spannerRules(`_${mode}_`, () => direction, spanners),
  [`_${mode}_articulation`]: $ => seq(direction, articulationMark($)),
  [`_${mode}_fingering`]: $ => seq(direction, $.number),
  [`_${mode}_text_script`]: $ => seq(direction, choice($.string, $.markup)),
});

// Braces holding one mode's items, with `\sequential` before them if wanted.
const sequentialOf = (item) => seq(optional('\\sequential'), '{', repeat(item), '}');

// `<< >>` holding one mode's items, or `\simultaneous` and braces.
const simultaneousOf = (item) => choice(
  seq('<<', repeat(item), '>>'),
  seq('\\simultaneous', '{', repeat(item), '}'),
);

// The constructs every mode keeps, because a backslash starts a command
// whichever mode reads the words.
const keywordItems = ($) => [
  $.command,
  $.dotted_name,
  $.new_context,
  $.override,
  $.set,
  $.revert,
  $.unset,
  $.repeat,
  $.tempo,
  $.change,
];

// The modes, any of which can stand inside another.
const modes = ($) => [
  $.lyric_mode,
  $.lyrics_to,
  $.add_lyrics,
  $.chord_mode,
  $.figure_mode,
  $.drum_mode,
  $.note_mode,
];

export default grammar({
  name: 'lilypond',

  // The order is fixed: the scanner indexes its valid-symbol array by it.
  externals: $ => [
    $.block_comment,
    $._embedded_start,
    $._embedded_end,
    $.scheme_block_comment,
    $._lyric_word,
    $._markup_word,
    $._assignment_start,
    $._markup_word_ahead,
    $._error_sentinel,
  ],

  // LilyPond's whitespace is ASCII: a no-break space is a letter to it, and a
  // vertical tab an error. A byte-order mark after the start of a file draws
  // a warning and is otherwise skipped.
  extras: $ => [/[ \t\n\r\f\uFEFF]/, $.line_comment, $.block_comment],

  // Each word below is a keyword everywhere, so where its construct cannot
  // stand, as `\override` cannot at the top level, it is an error and not a
  // plain command. Reserving a word needs a word token. A longer command such
  // as `\overrideProperty` still wins by length.
  word: $ => $.command,

  // Where a markup list ends is decided by which reading parses. See
  // `markup_list`. In chord mode a number before `/` may end a duration, with
  // an inversion after it as in `c4/e`, or start a fraction, as in `c1*3/4`,
  // and again the reading that parses wins.
  conflicts: $ => [[$.markup_list], [$.duration, $.fraction]],

  reserved: {
    global: _ => [
      '\\override', '\\set', '\\revert', '\\unset', '\\tempo', '\\change',
      '\\lyricmode', '\\lyrics', '\\addlyrics', '\\lyricsto',
      '\\markup', '\\markuplist',
      '\\chordmode', '\\chords', '\\figuremode', '\\figures', '\\drummode', '\\drums',
      '\\notemode',
    ],
  },

  rules: {
    source_file: $ => repeat($._toplevel),

    _toplevel: $ => choice(
      $.version,
      $.include,
      $.language,
      $.assignment,
      $.header_block,
      $.paper_block,
      $.layout_block,
      $.midi_block,
      $.score_block,
      $.book_block,
      $.bookpart_block,
      $._toplevel_music,
    ),

    version: $ => seq('\\version', field('value', $.string)),

    include: $ => seq('\\include', field('path', $.string)),

    language: $ => seq('\\language', field('name', $.string)),

    header_block: $ => seq(
      '\\header',
      '{',
      repeat(choice($.assignment, $.scheme)),
      '}',
    ),

    paper_block: $ => seq('\\paper', '{', repeat($._output_item), '}'),

    layout_block: $ => seq('\\layout', '{', repeat($._output_item), '}'),

    midi_block: $ => seq('\\midi', '{', repeat($._output_item), '}'),

    _output_item: $ => choice(
      $.assignment,
      $.scheme,
      $.context_definition,
      $.command,
      // A grob or context name after a command: `\accidentalStyle Score.modern`.
      $._identifier,
      alias($._dotted_identifier, $.dotted_name),
      $.override,
      $.set,
      $.revert,
      $.unset,
      $.tempo,
    ),

    // `\context { }` inside an output definition. In music `\context` names a
    // context instead, which makes it a `new_context`.
    context_definition: $ => seq(
      '\\context',
      '{',
      repeat($._context_item),
      '}',
    ),

    with_block: $ => seq('\\with', '{', repeat($._context_item), '}'),

    _context_item: $ => choice(
      $.context_modification,
      $.assignment,
      $.override,
      $.set,
      $.revert,
      $.unset,
      $.command,
      // A grob name after a command: `\omit TimeSignature`.
      $._identifier,
      alias($._dotted_identifier, $.dotted_name),
      $.scheme,
    ),

    context_modification: $ => seq(
      choice(
        '\\consists',
        '\\remove',
        '\\accepts',
        '\\denies',
        '\\alias',
        '\\name',
        '\\type',
        '\\defaultchild',
        '\\description',
      ),
      choice($.string, $._identifier, $.scheme),
    ),

    score_block: $ => seq(
      '\\score',
      '{',
      repeat(choice($._music, $.header_block, $.layout_block, $.midi_block)),
      '}',
    ),

    book_block: $ => seq(
      '\\book',
      '{',
      repeat(choice($._book_item, $.bookpart_block)),
      '}',
    ),

    bookpart_block: $ => seq('\\bookpart', '{', repeat($._book_item), '}'),

    _book_item: $ => choice(
      $._toplevel_music,
      $.score_block,
      $.header_block,
      $.paper_block,
    ),

    // The scanner emits `_assignment_start`, a zero-width token, only where a
    // name and then `=` lie ahead. One token of lookahead cannot see past the
    // `y` in `x = 1 y = 2` to its `=`, so without the scanner `y` would read as
    // a note with an octave check that continues the first value.
    assignment: $ => seq(
      $._assignment_start,
      field('name', choice(
        $._identifier,
        $.string,
        alias($._dotted_identifier, $.dotted_name),
      )),
      '=',
      field('value', $._value),
    ),

    // A value is complete after braces, a block, markup, a string, a Scheme
    // datum, or a number with its unit. Anything else starts a run of music
    // arguments, which ends at the first complete value or, without one, runs
    // on into whatever follows. Verses added with `\addlyrics` may follow the
    // music in either form.
    _value: $ => prec.right(choice(
      seq($._value_end, repeat($.add_lyrics)),
      $.string,
      $.scheme,
      seq(
        choice($.number, alias($._negative_number, $.number)),
        optional(alias($._unit, $.command)),
      ),
      seq(
        $._value_start,
        repeat(choice($._music_argument, $.add_lyrics)),
        optional(seq($._value_end, repeat($.add_lyrics))),
      ),
    )),

    _value_end: $ => choice(
      $.sequential_music,
      $.simultaneous_music,
      $.markup,
      $.markup_list,
      $.lyric_mode,
      $.lyrics_to,
      $.chord_mode,
      $.figure_mode,
      $.drum_mode,
      $.note_mode,
      $.header_block,
      $.paper_block,
      $.layout_block,
      $.midi_block,
      $.with_block,
      $.score_block,
      $.book_block,
      $.bookpart_block,
    ),

    // A unit after a number. Any variable that holds a number can be one, but
    // only LilyPond's own units are taken here, because a command on the line
    // after `x = 2` usually starts the next expression instead.
    _unit: _ => token(prec(1, choice('\\mm', '\\cm', '\\in', '\\pt', '\\bp'))),

    // Music at the top level of a file or a book is either complete in itself
    // or a command, context, repeat or alternative followed by its arguments.
    // A note, rest or duration cannot start it, and a bar check or markup
    // takes no arguments, which is how LilyPond reads them. The arguments run
    // on past braces, since a function may take more after a music argument,
    // as in `\fn { c } "x"`. `\score { c }` holds bare notes and so keeps
    // `_music`.
    _toplevel_music: $ => prec.right(choice(
      seq($._toplevel_end, repeat($.add_lyrics)),
      $.scheme,
      $.bar_check,
      seq(
        $._toplevel_start,
        repeat(choice($._music_argument, $._toplevel_end, $.add_lyrics)),
      ),
    )),

    _toplevel_start: $ => choice(
      $.command,
      $.dotted_name,
      $.new_context,
      $.repeat,
      $.alternative,
    ),

    _toplevel_end: $ => choice(
      $.sequential_music,
      $.simultaneous_music,
      $.markup,
      $.markup_list,
      $.lyric_mode,
      $.lyrics_to,
      $.chord_mode,
      $.figure_mode,
      $.drum_mode,
      $.note_mode,
    ),

    // A music sequence is flat: events, the post-events that follow them, the
    // bar checks between them and each command with its arguments are all
    // siblings. A verse added with `\addlyrics` is one more sibling.
    _music: $ => choice(
      $._music_argument,
      $.sequential_music,
      $.simultaneous_music,
      $.markup,
      $.lyric_mode,
      $.lyrics_to,
      $.add_lyrics,
      $.chord_mode,
      $.figure_mode,
      $.drum_mode,
      $.note_mode,
    ),

    // What a command can take as an argument without ending an assignment's
    // value. A duration, a string and a Scheme datum stay out of
    // `_value_start` because each one alone is already a whole value: `x = 4`
    // is a number.
    _music_argument: $ => choice(
      $._value_start,
      // A duration alone repeats the previous pitch: `c4 8 8`.
      $.duration,
      $.string,
      $.scheme,
    ),

    _value_start: $ => choice($._event, $.bar_check),

    // What a value can start with, but a bar check.
    _event: $ => choice(
      $.note,
      $.rest,
      $.skip,
      $.multi_measure_rest,
      $.chord_repetition,
      $.chord,
      // `\time 3/4`, and `\time 2,2,3 7/8`.
      $.fraction,
      $.number_list,
      $._post_event,
      $.voice_separator,
      $.command,
      $.dotted_name,
      // A grob path after a command: `\omit Staff.TimeSignature`.
      alias($._dotted_identifier, $.dotted_name),
      $.new_context,
      $.override,
      $.set,
      $.revert,
      $.unset,
      $.repeat,
      $.alternative,
      $.tempo,
      $.change,
    ),

    // Each bar inside the braces is a hidden node, its items and then the bar
    // check that ends it, so the tree still shows one flat sequence. After an
    // edit the parser reuses every other bar whole, where it would otherwise
    // step through a long piece note by note. Tree-sitter never reuses a node
    // whose first or last child is a repetition, so a bar starts with one item
    // before the rest repeat.
    sequential_music: $ => seq(
      optional('\\sequential'), '{',
      repeat(choice($._bar, $.bar_check)),
      optional($._run),
      '}',
    ),

    _bar: $ => seq($._run, $.bar_check),

    _run: $ => seq($._bar_item, repeat($._bar_item)),

    // `_music` but a bar check.
    _bar_item: $ => choice(
      $._event,
      $.duration,
      $.string,
      $.scheme,
      $.sequential_music,
      $.simultaneous_music,
      $.markup,
      $.lyric_mode,
      $.lyrics_to,
      $.add_lyrics,
      $.chord_mode,
      $.figure_mode,
      $.drum_mode,
      $.note_mode,
    ),

    simultaneous_music: $ => simultaneousOf($._music),

    // Each optional part attaches to the note when it can, so `c 4` is one
    // note with a duration, as LilyPond reads it.
    note: $ => prec.right(seq(
      field('pitch', $.pitch),
      optional($.accidental_mark),
      optional($.octave_check),
      optional(field('duration', $.duration)),
    )),

    pitch: $ => seq(alias($._word, $.note_name), optional($.octave)),

    octave: _ => /'+|,+/,

    // `!` forces an accidental and `?` makes it cautionary, in that order.
    accidental_mark: _ => /!+\?*|\?+/,

    octave_check: $ => seq('=', optional($.octave)),

    // The one-letter strings beat the word pattern at equal length, so `r4` is
    // a rest while `res4` stays a note.
    rest: $ => prec.right(seq('r', optional(field('duration', $.duration)))),

    skip: $ => prec.right(seq('s', optional(field('duration', $.duration)))),

    multi_measure_rest: $ => prec.right(seq(
      'R',
      optional(field('duration', $.duration)),
    )),

    chord_repetition: $ => prec.right(seq(
      'q',
      optional(field('duration', $.duration)),
    )),

    chord: $ => prec.right(seq(
      '<',
      // A command and its arguments may stand before a note, as in
      // `<c \tweak Stem.color #red e>`.
      repeat(choice(
        $.note,
        $._post_event,
        $.command,
        $.scheme,
        alias($._dotted_identifier, $.dotted_name),
      )),
      '>',
      optional(field('duration', $.duration)),
    )),

    duration: $ => prec.right(seq(
      choice($.number, '\\breve', '\\longa', '\\maxima'),
      repeat('.'),
      repeat(seq('*', choice($.number, $.fraction))),
    )),

    fraction: $ => seq(
      field('numerator', $.number),
      '/',
      field('denominator', $.number),
    ),

    // Post-events are siblings of the event they follow, never children,
    // because a command such as `\fermata` can itself be one.
    _post_event: $ => choice(
      $.tie,
      $.slur_start,
      $.slur_end,
      $.phrasing_slur_start,
      $.phrasing_slur_end,
      $.beam_start,
      $.beam_end,
      $.ligature_start,
      $.ligature_end,
      $.hairpin,
      $.hairpin_end,
      $.articulation,
      $.fingering,
      $.string_number,
      $.tremolo,
      $.text_script,
    ),

    ...spannerRules('', $ => $._direction, Object.keys(SPANNERS)),

    _direction: _ => choice('-', '^', '_'),

    articulation: $ => seq($._direction, articulationMark($)),

    fingering: $ => seq($._direction, $.number),

    string_number: _ => /\\\d+/,

    tremolo: _ => /:\d*/,

    text_script: $ => seq($._direction, choice($.string, $.markup)),

    bar_check: _ => '|',

    voice_separator: _ => '\\\\',

    // The music a new context holds follows it as the next sibling.
    new_context: $ => prec.right(seq(
      choice('\\new', '\\context'),
      field('type', $._identifier),
      optional(seq('=', field('name', choice($.string, $._identifier)))),
      optional(field('with', $.with_block)),
    )),

    change: $ => seq(
      '\\change',
      field('type', $._identifier),
      '=',
      field('name', choice($.string, $._identifier)),
    ),

    override: $ => seq(
      '\\override',
      field('path', $.property_path),
      '=',
      field('value', $._property_value),
    ),

    set: $ => seq(
      '\\set',
      field('path', $.property_path),
      '=',
      field('value', $._property_value),
    ),

    revert: $ => seq('\\revert', field('path', $.property_path)),

    unset: $ => seq('\\unset', field('path', $.property_path)),

    // `Staff.TimeSignature.stencil`, or the older form that gives the last
    // part in Scheme: `Staff.TimeSignature #'stencil`.
    property_path: $ => prec.right(seq(
      $._identifier,
      repeat(seq('.', $._identifier)),
      repeat($.scheme),
    )),

    _property_value: $ => choice(
      $.string,
      $.number,
      alias($._negative_number, $.number),
      $.number_list,
      $.scheme,
      $.markup,
      $.markup_list,
      $.command,
    ),

    // The music a repeat applies to follows it as the next sibling.
    repeat: $ => seq(
      '\\repeat',
      field('type', choice($._identifier, $.string)),
      field('count', $.number),
    ),

    alternative: $ => seq('\\alternative', '{', repeat($._music), '}'),

    // `\tempo 4 = 120`, `\tempo "Allegro" 4 = 100-120` or `\tempo "Andante"`.
    tempo: $ => prec.right(seq(
      '\\tempo',
      choice(
        seq(
          field('text', choice($.string, $.markup)),
          optional(metronomeMark($)),
        ),
        metronomeMark($),
      ),
    )),

    // `\lyricmode` and `\lyrics` switch to lyric mode for the braces or
    // `<< >>` that follow. Inside, those keep their usual names and hold
    // lyric items. `\lyrics` also creates a context, so a `\with` block may
    // come first, as it may after `\chords`, `\figures` and `\drums`.
    lyric_mode: $ => seq(
      choice('\\lyricmode', seq('\\lyrics', optional($.with_block))),
      $._lyric_music,
    ),

    // `\addlyrics` and `\lyricsto` switch to lyric mode only for braces or
    // `<< >>`. A variable after either stays a `command`.
    add_lyrics: $ => seq('\\addlyrics', choice($._lyric_music, $.command)),

    // The voice may come with its context type, as in `\lyricsto Staff = "S"`.
    lyrics_to: $ => seq(
      '\\lyricsto',
      optional(seq(field('type', $._identifier), '=')),
      field('voice', choice($.string, $._identifier, $.command)),
      choice($._lyric_music, $.command),
    ),

    _lyric_music: $ => choice(
      alias($._lyric_sequential, $.sequential_music),
      alias($._lyric_simultaneous, $.simultaneous_music),
    ),

    _lyric_sequential: $ => sequentialOf($._lyric_item),

    _lyric_simultaneous: $ => simultaneousOf($._lyric_item),

    // Lyric mode changes only how words are read. A digit still starts a
    // duration and a backslash a command, so the keyword constructs stand
    // here as they do in music.
    _lyric_item: $ => choice(
      alias($._lyric_word, $.lyric_word),
      $.lyric_hyphen,
      $.lyric_extender,
      $.duration,
      $.fraction,
      $.string,
      $.scheme,
      $.markup,
      $.bar_check,
      $.voice_separator,
      ...keywordItems($),
      alias($._lyric_alternative, $.alternative),
      $._lyric_music,
      ...modes($),
    ),

    _lyric_alternative: $ => seq('\\alternative', '{', repeat($._lyric_item), '}'),

    // Only standing alone. Touching a word, as in `a--b`, each is part of it.
    lyric_hyphen: _ => '--',

    lyric_extender: _ => '__',

    // `\chordmode` and `\chords` switch to chord mode, where a word is the
    // root of a chord name.
    chord_mode: $ => seq(
      choice('\\chordmode', seq('\\chords', optional($.with_block))),
      $._chord_music,
    ),

    _chord_music: $ => choice(
      alias($._chord_sequential, $.sequential_music),
      alias($._chord_simultaneous, $.simultaneous_music),
    ),

    _chord_sequential: $ => sequentialOf($._chord_item),

    _chord_simultaneous: $ => simultaneousOf($._chord_item),

    // Chord mode reads `-`, `^`, `.`, `:` and `/` as parts of a chord name, so
    // no tremolo follows a chord and a post-event's direction is `^` or `_`.
    _chord_item: $ => choice(
      $.chord_symbol,
      $.chord,
      $.rest,
      $.skip,
      $.multi_measure_rest,
      $.chord_repetition,
      $.duration,
      $.fraction,
      $._chord_post_event,
      $.bar_check,
      $.voice_separator,
      $.string,
      $.scheme,
      $.markup,
      ...keywordItems($),
      alias($._chord_alternative, $.alternative),
      $._chord_music,
      ...modes($),
    ),

    _chord_alternative: $ => seq('\\alternative', '{', repeat($._chord_item), '}'),

    _chord_post_event: $ => choice(...directedPostEvents($, 'chord')),

    ...directedPostEventRules('chord', choice('^', '_')),

    // A chord name: its root and duration, then the modifiers after `:`, the
    // note an inversion puts in the bass after `/`, and a bass note to add
    // after `/+`, in that order.
    chord_symbol: $ => prec.right(seq(
      field('root', $.pitch),
      optional(field('duration', $.duration)),
      optional(seq(':', optional(field('modifiers', $.chord_modifiers)))),
      optional(seq('/', field('inversion', $.pitch))),
      optional(seq('/+', field('bass', $.pitch))),
    )),

    // Words such as `m` and `sus`, steps with an optional `+` or `-`, `.`
    // between two steps, and `^` before the steps to leave out. The token
    // touches the colon, so in `c: e` the `e` is the next chord, as LilyPond
    // reads a note name there.
    chord_modifiers: _ => token.immediate(prec(1, /([A-Za-z]+|\d+[+-]?(\.\d+[+-]?)*|\^)+/)),

    // `\figuremode` and `\figures` switch to figure mode, which reads every
    // `<` as the start of a figure group, so `<< >>` cannot stand there.
    figure_mode: $ => seq(
      choice('\\figuremode', seq('\\figures', optional($.with_block))),
      $._figure_music,
    ),

    _figure_music: $ => choice(
      alias($._figure_sequential, $.sequential_music),
      alias($._figure_simultaneous, $.simultaneous_music),
    ),

    _figure_sequential: $ => sequentialOf($._figure_item),

    _figure_simultaneous: $ => seq('\\simultaneous', '{', repeat($._figure_item), '}'),

    // Figure mode reads `-`, `_`, `[`, `]`, `\!` and `\\` as parts of a figure,
    // so a post-event's direction is `^`, and no beam, hairpin end or voice
    // separator stands there.
    _figure_item: $ => choice(
      $.figure_group,
      $.rest,
      $.skip,
      $.multi_measure_rest,
      $.chord_repetition,
      $.duration,
      $.fraction,
      $._figure_post_event,
      $.bar_check,
      $.string,
      $.scheme,
      $.markup,
      ...keywordItems($),
      alias($._figure_alternative, $.alternative),
      $._figure_music,
      ...modes($),
    ),

    _figure_alternative: $ => seq('\\alternative', '{', repeat($._figure_item), '}'),

    _figure_post_event: $ => choice(
      $.tremolo,
      ...directedPostEvents($, 'figure', FIGURE_SPANNERS),
    ),

    ...directedPostEventRules('figure', '^', FIGURE_SPANNERS),

    figure_group: $ => prec.right(seq(
      '<',
      repeat($.figure),
      '>',
      optional(field('duration', $.duration)),
    )),

    // A number, `_` for no number, a string or markup. A `[` before it opens a
    // bracket and a `]` after it closes one. Alterations (`+`, `-`, `!`) and
    // modifications (`\+`, `\!`, `/`, `\\`) follow it.
    figure: $ => seq(
      optional('['),
      choice($.number, '_', $.string, $.markup),
      repeat(choice('+', '-', '!', '\\+', '\\!', '/', '\\\\', ']')),
    ),

    // Drum mode reads drum names where notes stand. Which names exist is known
    // only when LilyPond runs, so they are notes here.
    drum_mode: $ => seq(
      choice('\\drummode', seq('\\drums', optional($.with_block))),
      choice($.sequential_music, $.simultaneous_music),
    ),

    note_mode: $ => seq('\\notemode', choice($.sequential_music, $.simultaneous_music)),

    // Markup is `\markup`, then any markup commands and their Scheme
    // arguments, then at most one argument: braces, a word, a string or a
    // score. How many arguments a command takes is known only when LilyPond
    // runs, so the commands are flat and the markup ends after its first
    // argument. A command with two markup arguments therefore leaves its
    // second outside, unless the markup is braced. The argument may be left
    // out after a command, which can be a variable holding a whole markup.
    markup: $ => prec.right(seq('\\markup', markupContent($, $._markup_argument))),

    // Where an assignment may follow the markup, the scanner looks past a word
    // for `=` before it knows the word is the markup's, and by then the word's
    // end is behind it. So it first emits `_markup_word_ahead`, a zero-width
    // token, and reads the word on the next call.
    _markup_argument: $ => choice(
      $.markup_block,
      seq(optional($._markup_word_ahead), alias($._markup_word, $.markup_word)),
      $.string,
      $.score_block,
    ),

    // A markup list takes braces or a Scheme datum, never a word or a string.
    // Its commands are flat as markup's are, but what follows a list that ends
    // in a command, as `\\markuplist \\table-of-contents` does, is as often new
    // music as more of the list. So both readings run, and one that meets an
    // error is dropped. Where both parse, the list goes on.
    markup_list: $ => seq('\\markuplist', choice(
      seq(
        repeat1(choice(prec.dynamic(1, markupCommand($)), $.scheme)),
        optional(prec.dynamic(1, $.markup_block)),
      ),
      $.markup_block,
    )),

    markup_block: $ => seq(
      '{',
      repeat(choice(markupCommand($), $.scheme, $._markup_argument)),
      '}',
    ),

    // `%` followed by anything but `{` runs to the end of the line, and stops
    // before a carriage return so that CRLF files do not end in it.
    line_comment: _ => token(seq('%', optional(seq(/[^{\r\n]/, /[^\r\n]*/)))),

    // A block comment ends at the first `%}`, so `%%%}` closes one and `%{`
    // inside one does not nest. The external scanner may claim it first, which
    // matters only inside `#{ #}`; an unterminated `%{` matches nothing here
    // and so shows as an error where it opens, as LilyPond reports it.
    block_comment: _ => token(seq('%{', /([^%]|%+[^%}])*/, /%+\}/)),

    string: $ => seq(
      '"',
      repeat(choice(
        token.immediate(prec(1, /[^"\\]+/)),
        $.escape_sequence,
        // A backslash before any other character is a literal backslash.
        token.immediate('\\'),
      )),
      token.immediate('"'),
    ),

    escape_sequence: _ => token.immediate(/\\[nt\\'"]/),

    number: _ => /\d+(\.\d+)?/,

    // A minus sign touching a number. It stands only in a value, since in
    // music `-2` is a fingering.
    _negative_number: _ => token(/-\d+(\.\d+)?/),

    // Numbers joined by commas, as in `\time 2,2,3 7/8`. Each comma touches
    // the number before it.
    number_list: $ => seq($.number, repeat1(seq(token.immediate(','), $.number))),

    // LilyPond's `#` or `$`, then one Scheme datum. Scheme reads `{` and `}`
    // as symbols here, but no file binds them, so LilyPond always rejects
    // `#{` and `#}` at this level and the tree marks them as errors too.
    // Embedded LilyPond needs a second `#`: `##{ c #}`.
    scheme: $ => seq(
      choice('#', '$'),
      choice(alias($._scheme_top_symbol, $.scheme_symbol), $._scheme_value),
    ),

    _scheme_datum: $ => choice($.scheme_symbol, $._scheme_value),

    _scheme_value: $ => choice(
      $.scheme_number,
      $.scheme_boolean,
      $.scheme_character,
      $.scheme_keyword,
      $.scheme_string,
      $.scheme_list,
      $.scheme_vector,
      $.scheme_quote,
      $.scheme_quasiquote,
      $.scheme_unquote,
      $.scheme_unquote_splicing,
      $.embedded_lilypond,
    ),

    // Comments are list elements rather than extras, because an extra is
    // valid everywhere and `;` is not a comment in LilyPond.
    _scheme_element: $ => choice(
      $._scheme_datum,
      $.scheme_comment,
      $.scheme_block_comment,
      $.scheme_datum_comment,
    ),

    scheme_list: $ => seq(
      '(',
      repeat($._scheme_element),
      optional(seq('.', $._scheme_element, repeat($._scheme_element))),
      ')',
    ),

    scheme_vector: $ => seq('#(', repeat($._scheme_element), ')'),

    scheme_quote: $ => seq('\'', $._scheme_datum),

    scheme_quasiquote: $ => seq('`', $._scheme_datum),

    scheme_unquote: $ => seq(',', $._scheme_datum),

    scheme_unquote_splicing: $ => seq(',@', $._scheme_datum),

    scheme_datum_comment: $ => seq('#;', $._scheme_datum),

    scheme_comment: _ => token(seq(';', /[^\r\n]*/)),

    // Numbers and symbols outrank the LilyPond comment tokens, because `%`
    // is an ordinary symbol character inside Scheme. They share a precedence
    // so that the longer match wins, which keeps `1+` a symbol, and the number
    // is declared first so that it wins a tie, which makes `1/2` a number.
    scheme_number: _ => token(prec(1, choice(
      /[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?(\/\d+)?/,
      /#[xXbBoOdDeEiI][^\s()";'`,]+/,
    ))),

    scheme_symbol: _ => token(prec(1, schemeSymbol(''))),

    _scheme_top_symbol: _ => token(prec(1, schemeSymbol('{}'))),

    scheme_boolean: _ => /#(t|f|true|false)/,

    // `#\a`, `#\space` or `#\x41`: one character, then any name it starts.
    scheme_character: _ => /#\\(.|\n)[^\s()";'`,]*/,

    scheme_keyword: _ => /#:[^\s()";'`,]+/,

    scheme_string: $ => seq(
      '"',
      repeat(choice(
        token.immediate(prec(1, /[^"\\]+/)),
        alias($._scheme_escape, $.escape_sequence),
      )),
      token.immediate('"'),
    ),

    _scheme_escape: _ => token.immediate(
      /\\(x[0-9a-fA-F]+;|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{6}|\r\n|[^xuU])/,
    ),

    // `#{ ... #}` as a Scheme datum. The scanner tracks how deep these nest.
    // The delimiters are aliased to their text so queries can name them.
    embedded_lilypond: $ => seq(
      alias($._embedded_start, '#{'),
      repeat($._music),
      alias($._embedded_end, '#}'),
    ),

    // `\word`, or `\"any text"`, which names a variable whose name is not a
    // word.
    command: _ => token(choice(
      new RegExp(`\\\\${WORD}`),
      /\\"([^"\\]|\\.)*"/,
    )),

    // One word token serves every position, because Tree-sitter cannot lex two
    // identical patterns differently. Its alias names what the word is there.
    _word: _ => token(new RegExp(WORD)),

    _identifier: $ => alias($._word, $.identifier),

    // `\verse.1`, a reference to a variable whose name has dotted parts. In
    // the name before `=` the first part is a word instead, and that is the
    // same node.
    dotted_name: $ => seq($.command, repeat1($._dotted_part)),

    _dotted_identifier: $ => seq($._identifier, repeat1($._dotted_part)),

    _dotted_part: $ => seq('.', choice($._identifier, $.number)),
  },
});
