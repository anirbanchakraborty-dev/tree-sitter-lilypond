# tree-sitter-lilypond

A [Tree-sitter](https://tree-sitter.github.io/) grammar for [LilyPond](https://lilypond.org/) 2.26, the music engraving language. It is part of [Swara](https://github.com/anirbanchakraborty-dev/swara), a LilyPond language server and Neovim plugin, and it works on its own in any editor that embeds Tree-sitter.

## Status

Early. The grammar currently covers comments, strings and the top-level `\version`, `\include`, `\language` and `\header` forms. Music, embedded Scheme, the input modes and the queries follow. The names of the nodes the grammar produces, and the rules behind them, are fixed in [docs/nodes.md](docs/nodes.md).

## What it aims for

- **Agreement with LilyPond.** Every example in `test/corpus/` is a complete file, and a test runs LilyPond 2.26.0 on each one: it must accept every example except those marked `:error`, which it must reject. Every syntax fact the grammar encodes is checked against the compiler rather than taken from memory.
- **One tree for both languages.** Embedded Scheme, and LilyPond embedded inside that Scheme with `#{ #}`, parse into the same tree as the music around them.
- **Speed.** The grammar is measured against a fixed corpus of public scores, and a one-character edit in a large score must reparse within an editor's colouring budget.
- **Queries with no word lists.** The highlight, fold, indent and locals queries colour by the shape of the syntax, not by lists of LilyPond command names.

## Building and testing

The grammar needs the Tree-sitter CLI 0.27.1 and Node.js to generate the parser, and Rust 1.98 for the tests.

```bash
tree-sitter generate
```

```bash
tree-sitter test
```

```bash
cargo test
```

`cargo test` includes the agreement test, which needs LilyPond 2.26.0 on the path. Without it, or with a different version, the test prints one line saying so and passes.

The generated `src/parser.c`, `src/grammar.json` and `src/node-types.json` are committed, and they are regenerated in the same commit as any change to `grammar.js`.

## Licence

MIT. The grammar is written from LilyPond's documented behaviour and from what the compiler accepts. No code, queries, word lists or documentation are copied from LilyPond or from any other GPL project.
