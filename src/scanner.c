// External scanner for the LilyPond grammar.
//
// It keeps one byte of state, the nesting depth of `#{ #}`. It claims the two
// delimiters of embedded LilyPond and Scheme's nesting `#| |#` comments, which
// no regular expression can count. Everything that hides a `#}` (a string, a
// comment, a Scheme symbol that touches it) is an ordinary token, so the parser
// never asks for `_embedded_end` inside one and the reader's rules fall out of
// the lexer's own.
//
// It also emits `_assignment_start`, a zero-width token, where a name and then
// `=` lie ahead. The parser has one token of lookahead, which cannot see past
// the name to the `=`, and `_markup_word_ahead`, also zero-width, where that
// look found a markup word instead. And it reads lyric and markup words, whose
// end depends on whether the word sits inside `#{ #}`, and markup words inside
// braces apart from the rest, since only there can a word be `<<` or `>>`.

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

enum TokenType {
    BLOCK_COMMENT,
    EMBEDDED_START,
    EMBEDDED_END,
    SCHEME_BLOCK_COMMENT,
    LYRIC_WORD,
    MARKUP_WORD,
    ASSIGNMENT_START,
    MARKUP_WORD_AHEAD,
    MARKUP_BLOCK_WORD,
    ERROR_SENTINEL,
};

typedef struct {
    uint8_t depth;
} Scanner;

void *tree_sitter_lilypond_external_scanner_create(void) {
    return calloc(1, sizeof(Scanner));
}

void tree_sitter_lilypond_external_scanner_destroy(void *payload) {
    free(payload);
}

unsigned tree_sitter_lilypond_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = payload;
    buffer[0] = (char)scanner->depth;
    return 1;
}

void tree_sitter_lilypond_external_scanner_deserialize(void *payload, const char *buffer,
                                                       unsigned length) {
    Scanner *scanner = payload;
    scanner->depth = length > 0 ? (uint8_t)buffer[0] : 0;
}

// Whitespace as LilyPond reads it: space, tab, line feed, carriage return and
// form feed, and the byte-order mark, which it skips after the start of a
// file. Not `iswspace`, whose answer for other spaces depends on the locale.
static bool is_space(int32_t c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == 0xFEFF;
}

static void skip_whitespace(TSLexer *lexer) {
    while (is_space(lexer->lookahead)) {
        lexer->advance(lexer, true);
    }
}

// Consumes the rest of a Scheme block comment after its opening `#|`. Each
// further `#|` opens a level that needs its own `|#`. Returns false at the end
// of input, so an unterminated comment is an error where it opens.
static bool scan_scheme_block_comment(TSLexer *lexer) {
    unsigned nesting = 1;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '|') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '#') {
                lexer->advance(lexer, false);
                if (--nesting == 0) {
                    return true;
                }
            }
        } else if (lexer->lookahead == '#') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '|') {
                lexer->advance(lexer, false);
                nesting++;
            }
        } else {
            lexer->advance(lexer, false);
        }
    }
    return false;
}

// A letter as LilyPond's lexer counts one, matching LETTER in grammar.js: an
// ASCII letter or any character outside ASCII but the byte-order mark.
static bool is_letter(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= 0x80 && c != 0xFEFF);
}

static bool is_digit(int32_t c) {
    return c >= '0' && c <= '9';
}

// Moves past whitespace inside a lookahead, after the token's end is marked,
// where skip_whitespace would move the token's start instead.
static void pass_whitespace(TSLexer *lexer) {
    while (is_space(lexer->lookahead)) {
        lexer->advance(lexer, false);
    }
}

// A word, matching WORD in grammar.js: letters, with a single `-` or `_`
// between two of them.
static bool pass_word(TSLexer *lexer) {
    if (!is_letter(lexer->lookahead)) {
        return false;
    }
    while (is_letter(lexer->lookahead)) {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '-' || lexer->lookahead == '_') {
            lexer->advance(lexer, false);
            if (!is_letter(lexer->lookahead)) {
                return false;
            }
        }
    }
    return true;
}

// A double-quoted string. A backslash takes the next character with it.
static bool pass_string(TSLexer *lexer) {
    lexer->advance(lexer, false);
    while (!lexer->eof(lexer)) {
        int32_t c = lexer->lookahead;
        lexer->advance(lexer, false);
        if (c == '"') {
            return true;
        }
        if (c == '\\' && !lexer->eof(lexer)) {
            lexer->advance(lexer, false);
        }
    }
    return false;
}

// True when a name lies ahead followed by `=`: a string, or a word with any
// dotted parts such as `verse.1`. An `=` followed by `'` or `,` is an octave
// check on a note, as in `c='`, not an assignment.
static bool pass_assignment_name(TSLexer *lexer) {
    if (lexer->lookahead == '"') {
        if (!pass_string(lexer)) {
            return false;
        }
        pass_whitespace(lexer);
    } else {
        if (!pass_word(lexer)) {
            return false;
        }
        pass_whitespace(lexer);
        while (lexer->lookahead == '.') {
            lexer->advance(lexer, false);
            pass_whitespace(lexer);
            if (is_digit(lexer->lookahead)) {
                while (is_digit(lexer->lookahead)) {
                    lexer->advance(lexer, false);
                }
            } else if (!pass_word(lexer)) {
                return false;
            }
            pass_whitespace(lexer);
        }
    }
    if (lexer->lookahead != '=') {
        return false;
    }
    lexer->advance(lexer, false);
    pass_whitespace(lexer);
    return lexer->lookahead != '\'' && lexer->lookahead != ',';
}

// A character that ends a markup word. Inside `#{ #}` the Scheme reader sees a
// `%` before LilyPond does, and to the reader it starts a comment.
static bool ends_markup_word(TSLexer *lexer, bool embedded) {
    int32_t c = lexer->lookahead;
    return lexer->eof(lexer) || is_space(c) || c == '$' || c == '#' || c == '{' || c == '}' ||
           c == '"' || c == '\\' || (embedded && c == '%');
}

// A lyric word ends at a digit as well, so `a4` is a word and its duration.
static bool ends_lyric_word(TSLexer *lexer, bool embedded) {
    return ends_markup_word(lexer, embedded) || is_digit(lexer->lookahead);
}

// A markup word: anything up to an ending character. A `%` cannot come first,
// since there it starts a comment. Outside braces a word that is exactly `<<`
// or `>>` is left to the music, because markup whose last command takes no
// word, such as `\markup \vspace #2`, is far more often followed by `<<` than
// given one.
static bool scan_markup_word(TSLexer *lexer, bool embedded, bool braced) {
    int32_t first = lexer->lookahead;
    if (ends_markup_word(lexer, embedded) || first == '%') {
        return false;
    }
    lexer->advance(lexer, false);
    int32_t second = lexer->lookahead;
    unsigned length = 1;
    while (!ends_markup_word(lexer, embedded)) {
        lexer->advance(lexer, false);
        length++;
    }
    if (braced) {
        lexer->result_symbol = MARKUP_BLOCK_WORD;
        return true;
    }
    if (length == 2 && first == second && (first == '<' || first == '>')) {
        return false;
    }
    lexer->result_symbol = MARKUP_WORD;
    return true;
}

// A lyric word: anything up to an ending character, where the first character
// is not one of `% | * . =` either. A word that is exactly `--`, `__`, `<<` or
// `>>` is the token of that name instead. A `/` that touches a number before it
// and a digit after it divides a fraction, as in `\time 3/4`.
static bool scan_lyric_word(TSLexer *lexer, bool embedded, bool spaced) {
    int32_t first = lexer->lookahead;
    if (ends_lyric_word(lexer, embedded) || first == '%' || first == '|' || first == '*' ||
        first == '.' || first == '=') {
        return false;
    }
    lexer->advance(lexer, false);
    int32_t second = lexer->lookahead;
    unsigned length = 1;
    while (!ends_lyric_word(lexer, embedded)) {
        lexer->advance(lexer, false);
        length++;
    }
    if (length == 2 && first == second &&
        (first == '-' || first == '_' || first == '<' || first == '>')) {
        return false;
    }
    if (length == 1 && first == '/' && !spaced && is_digit(lexer->lookahead)) {
        return false;
    }
    lexer->result_symbol = LYRIC_WORD;
    return true;
}

bool tree_sitter_lilypond_external_scanner_scan(void *payload, TSLexer *lexer,
                                                const bool *valid_symbols) {
    Scanner *scanner = payload;

    // During error recovery every symbol is valid at once. Claiming a delimiter
    // then would move the depth on a guess, so the scanner stays out of it.
    if (valid_symbols[ERROR_SENTINEL]) {
        return false;
    }

    bool want_start = valid_symbols[EMBEDDED_START];
    bool want_end = valid_symbols[EMBEDDED_END] && scanner->depth > 0;
    bool want_comment = valid_symbols[SCHEME_BLOCK_COMMENT];
    bool want_assignment = valid_symbols[ASSIGNMENT_START];
    bool want_lyric = valid_symbols[LYRIC_WORD];
    bool want_braced = valid_symbols[MARKUP_BLOCK_WORD];
    bool want_markup = valid_symbols[MARKUP_WORD] || want_braced;
    if (!want_start && !want_end && !want_comment && !want_assignment && !want_lyric &&
        !want_markup) {
        return false;
    }

    bool spaced = is_space(lexer->lookahead);
    skip_whitespace(lexer);

    // Marking the end before looking ahead keeps the token zero-width, so the
    // name is still there for the parser to read.
    if (want_assignment && (is_letter(lexer->lookahead) || lexer->lookahead == '"')) {
        bool word = lexer->lookahead != '"';
        lexer->mark_end(lexer);
        if (pass_assignment_name(lexer)) {
            lexer->result_symbol = ASSIGNMENT_START;
            return true;
        }
        // Not a name and `=`, so where markup may take an argument the word is
        // the markup's. Its end now lies behind the lookahead, so a zero-width
        // token says a word comes next, and the next call reads it.
        if (word && valid_symbols[MARKUP_WORD_AHEAD]) {
            lexer->result_symbol = MARKUP_WORD_AHEAD;
            return true;
        }
        return false;
    }

    // Where markup may take an argument and lyrics may follow it, as after
    // `\markup \bold` in lyric mode, the word is the markup's.
    if (lexer->lookahead != '#') {
        bool embedded = scanner->depth > 0;
        if (want_markup) {
            return scan_markup_word(lexer, embedded, want_braced);
        }
        return want_lyric && scan_lyric_word(lexer, embedded, spaced);
    }
    lexer->advance(lexer, false);

    if (want_start && lexer->lookahead == '{') {
        lexer->advance(lexer, false);
        if (scanner->depth < UINT8_MAX) {
            scanner->depth++;
        }
        lexer->result_symbol = EMBEDDED_START;
        return true;
    }

    if (want_end && lexer->lookahead == '}') {
        lexer->advance(lexer, false);
        scanner->depth--;
        lexer->result_symbol = EMBEDDED_END;
        return true;
    }

    if (want_comment && lexer->lookahead == '|') {
        lexer->advance(lexer, false);
        if (scan_scheme_block_comment(lexer)) {
            lexer->result_symbol = SCHEME_BLOCK_COMMENT;
            return true;
        }
    }

    return false;
}
