# Node contract

The Swara language server and the queries in `queries/` depend on the node names below. A rename is a contract change: it updates this file, the queries and the server in the same release. The grammar is being built in stages, so some names below are not produced yet. Each is a promise that a later stage keeps under exactly that name.

## The names

- **File and text:** `source_file`, `line_comment`, `block_comment`, `string` (children `escape_sequence`), `number`, `fraction` (fields `numerator`, `denominator`), `version` (field `value: string`), `include` (field `path: string`), `language` (field `name: string`).
- **Words and commands:** `command` is a leaf for a backslash word, and includes the `\"any text"` form. `identifier` is a word in a position that names something. `assignment` has fields `name` (`identifier`, `string` or `dotted_name`) and `value`. When the value is flat, such as a number and its unit command, or a command and its arguments, `value` holds each node in order.
- **Blocks:** `header_block`, `paper_block`, `layout_block`, `midi_block`, `context_definition` (`\context { }` inside `\layout` or `\midi`), `score_block`, `book_block`, `bookpart_block`.
- **Contexts and properties:** `new_context` (`\new` or `\context` in music, fields `type: identifier`, optional `name`, optional `with: with_block`, with the music following as the next sibling), `with_block`, `context_modification` (`\consists`, `\remove`, `\accepts`, `\denies`, `\alias`, `\name`, `\type`, `\defaultchild`, `\description` with its argument), `override` and `set` (fields `path: property_path`, `value`), `revert` and `unset` (field `path`), `property_path`.
- **Keyword constructs:** `repeat` (fields `type: identifier`, `count: number`), `alternative`, `tempo`, `change`.
- **Music:** `sequential_music` (`{ }`, and `\sequential { }`), `simultaneous_music` (`<< >>`, and `\simultaneous { }`), `note` (field `pitch: pitch`, whose children are `note_name` and an optional `octave`, followed by an optional `accidental_mark`, an optional `octave_check` and an optional field `duration`), `rest`, `skip`, `multi_measure_rest`, `chord_repetition`, `chord` (`< >` holding notes, field `duration`), `duration` (a number or `\breve`, `\longa`, `\maxima`, with dots and `*` multipliers). A lone duration in music, as in `c4 8 8`, is a `duration` node in the sequence.
- **Post-events** are siblings of the event they follow, never children, because a command such as `\f` or `\fermata` can itself be a post-event and is parsed flat: `tie`, `slur_start`, `slur_end`, `phrasing_slur_start`, `phrasing_slur_end`, `beam_start`, `beam_end`, `ligature_start`, `ligature_end`, `hairpin` (`\<` and `\>`), `hairpin_end` (`\!`), `articulation` (a direction `-`, `^` or `_` with a shorthand or a command), `fingering`, `string_number`, `tremolo`, `text_script` (a direction with a string or markup), `bar_check`, `voice_separator`.
- **Modes:** `note_mode`, `drum_mode`, `chord_mode`, `figure_mode`, `lyric_mode`, `add_lyrics`, `lyrics_to` (field `voice`), `markup`, `markup_list`.
- **Mode content:** `chord_symbol` (fields `root`, optional `duration`, optional `modifiers: chord_modifiers`, optional `inversion`, optional `bass`), `figure_group`, `figure`, `lyric_word`, `lyric_hyphen`, `lyric_extender`, `markup_word`, `markup_block`. Inside lyric mode, braces produce `sequential_music`.
- **Scheme:** `scheme` (the prefix `#` or `$`, then one datum), `scheme_list`, `scheme_vector`, `scheme_quote`, `scheme_quasiquote`, `scheme_unquote`, `scheme_unquote_splicing`, `scheme_symbol`, `scheme_number`, `scheme_string`, `scheme_boolean`, `scheme_character`, `scheme_keyword`, `scheme_comment`, `scheme_block_comment`, `scheme_datum_comment`, `embedded_lilypond`.

## Why commands are flat

A LilyPond command and the expressions after it are siblings in the tree, not parent and children. How many arguments a command takes is known only when LilyPond runs, because any music function can be defined or redefined in the file itself, so a grammar that nested arguments under their command would guess wrong for every function it had not been told about. Parsing flat keeps the tree correct for every function, known or not, and leaves argument counting to the language server, which reads signatures.

Two consequences of this are accepted.

- **A note-shaped word is a `note`** even where LilyPond reads it as a word argument, as in `\clef treble`. The server tells the two apart using the command's signature.
- **An assignment whose value ends in a music function's last argument** may absorb a following top-level music expression into its `value`. This changes no colour and raises no error.

## Comments

A `%` followed by anything but `{` starts a `line_comment`, which ends before the next carriage return or line feed, so a file with Windows line endings parses the same as one with Unix endings. `%{` starts a `block_comment`, which ends at the first `%}`. Block comments do not nest, so `%{ a %{ b %}` is one comment, and `%%%}` closes one. An unterminated `%{` is not a comment: it shows as an error where it opens, which is where LilyPond reports it.

## Reader rules inside `#{ #}`

LilyPond's `#` and `$` each hand exactly one datum to Scheme. Embedded LilyPond, `#{ … #}`, is itself a Scheme datum, so it opens only where Scheme is reading one: after a second `#`, as in `##{ c #}`, or as an element of a Scheme list, as in `#(list #{ c #})` or `$(list #{ c #})`. Directly after LilyPond's own `#` or `$`, Scheme reads `{` as the start of a symbol, and no file binds such a symbol, so `x = #{ c #}` fails to compile. The tree marks that `{` as an error, and a stray `#}` outside embedded LilyPond is an error for the same reason. These verdicts come from LilyPond 2.26.0's exit status, measured on 2026-10-24.

Inside embedded LilyPond, `#}` closes at its first occurrence that is not part of some other token, even when it touches the note before it, so `##{c#}` holds one note. A `#}` is hidden by a `%` line comment, by a `%{ %}` block comment and by a string, and inside embedded Scheme by a Scheme string or a `;` comment. A comment inside a markup block hides the block's closing brace as well, so `##{ \markup { 50% off } #}` leaves the block open and is an error, which is how LilyPond reports it.

A Scheme symbol runs until whitespace, a parenthesis, a double quote, a `;`, a quote, a backquote or a comma. A `#}` or `}` that touches a symbol therefore belongs to it: `#'x#}` quotes the single symbol `x#}`, and `#red}` is the single symbol `red}`, which leaves the enclosing brace unclosed. Inside Scheme `%` is an ordinary symbol character, so `#(let ((%a 1)) %a)` holds no comment. A `#{` inside Scheme inside embedded LilyPond opens a new level that needs its own `#}`, and the scanner counts the levels. Scheme block comments `#| |#` nest the same way, and an unterminated one is an error where it opens.
