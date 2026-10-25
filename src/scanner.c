// External scanner for the LilyPond grammar.
//
// It keeps one byte of state, the nesting depth of `#{ #}`. It claims the two
// delimiters of embedded LilyPond and Scheme's nesting `#| |#` comments, which
// no regular expression can count. Everything that hides a `#}` (a string, a
// comment, a Scheme symbol that touches it) is an ordinary token, so the parser
// never asks for `_embedded_end` inside one and the reader's rules fall out of
// the lexer's own.

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <wctype.h>

enum TokenType {
    BLOCK_COMMENT,
    EMBEDDED_START,
    EMBEDDED_END,
    SCHEME_BLOCK_COMMENT,
    LYRIC_WORD,
    MARKUP_WORD,
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

static void skip_whitespace(TSLexer *lexer) {
    while (iswspace(lexer->lookahead)) {
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
    if (!want_start && !want_end && !want_comment) {
        return false;
    }

    skip_whitespace(lexer);
    if (lexer->lookahead != '#') {
        return false;
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
