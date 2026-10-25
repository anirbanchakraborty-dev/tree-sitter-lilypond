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

    _value: $ => choice($.string, $.number),

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

    // `\word`, or `\"any text"`, which names a variable whose name is not a
    // word.
    command: _ => token(choice(
      new RegExp(`\\\\${WORD}`),
      /\\"([^"\\]|\\.)*"/,
    )),

    identifier: _ => token(new RegExp(WORD)),
  },
});
