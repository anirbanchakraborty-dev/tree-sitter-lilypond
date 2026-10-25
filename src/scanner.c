// External scanner for the LilyPond grammar.
//
// It keeps one byte of state, the nesting depth of `#{ #}`, because LilyPond's
// reader treats `%` differently inside embedded LilyPond.

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

bool tree_sitter_lilypond_external_scanner_scan(void *payload, TSLexer *lexer,
                                                const bool *valid_symbols) {
    (void)payload;
    (void)lexer;
    (void)valid_symbols;
    // Outside `#{ #}` every token this scanner lists is left to the grammar's
    // own rules, or to a later stage of the grammar.
    return false;
}
