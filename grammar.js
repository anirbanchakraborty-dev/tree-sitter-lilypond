/**
 * @file LilyPond grammar for Tree-sitter, with embedded Scheme in the same tree
 * @author Anirban Chakraborty
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// A letter, as LilyPond's lexer counts one: an ASCII letter or any character
// outside ASCII. The class excludes every other ASCII character, so it keeps
// Bengali and every other script, including characters beyond the BMP.
const LETTER = '[^\\x00-\\x40\\x5B-\\x60\\x7B-\\x7F]';

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
    $._error_sentinel,
  ],

  extras: $ => [/\s/, $.line_comment, $.block_comment],

  word: $ => $.command,

  rules: {
    source_file: $ => repeat($._toplevel),

    _toplevel: $ => choice(
      $.version,
      $.include,
      $.language,
      $.header_block,
      $.assignment,
      $.scheme,
      $.sequential_music,
    ),

    version: $ => seq('\\version', field('value', $.string)),

    include: $ => seq('\\include', field('path', $.string)),

    language: $ => seq('\\language', field('name', $.string)),

    header_block: $ => seq('\\header', '{', repeat($.assignment), '}'),

    assignment: $ => seq(
      field('name', $.identifier),
      '=',
      field('value', $._value),
    ),

    _value: $ => choice($.string, $.number, $.scheme),

    // Provisional: the note-mode task replaces `sequential_music`, `note` and
    // `pitch` under the same names, and the commands task replaces `override`.
    _music: $ => choice($.sequential_music, $.note, $.override, $.scheme),

    sequential_music: $ => seq('{', repeat($._music), '}'),

    note: $ => field('pitch', $.pitch),

    pitch: $ => alias($.identifier, $.note_name),

    override: $ => seq(
      '\\override',
      field('path', $.property_path),
      '=',
      field('value', $._value),
    ),

    property_path: $ => seq($.identifier, repeat(seq('.', $.identifier))),

    // Provisional: the markup task replaces these under the same names.
    markup: $ => seq('\\markup', $._markup_argument),

    _markup_argument: $ => choice($.string, $.markup_block, $.scheme),

    markup_block: $ => seq(
      '{',
      repeat(choice($.markup_word, $.string, $.markup_block, $.scheme)),
      '}',
    ),

    markup_word: _ => /[^\s{}"\\#$%]+/,

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
    embedded_lilypond: $ => seq(
      $._embedded_start,
      repeat(choice($._music, $.string, $.markup)),
      $._embedded_end,
    ),

    // `\word`, or `\"any text"`, which names a variable whose name is not a
    // word.
    command: _ => token(choice(
      new RegExp(`\\\\${WORD}`),
      /\\"([^"\\]|\\.)*"/,
    )),

    identifier: _ => token(new RegExp(WORD)),
  },
});
