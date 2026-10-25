# tree-sitter-lilypond

A [Tree-sitter](https://tree-sitter.github.io/) grammar for [LilyPond](https://lilypond.org/) 2.26, the music engraving language. It is part of [Swara](https://github.com/anirbanchakraborty-dev/swara), a LilyPond language server and Neovim plugin, and it works on its own in any editor that embeds Tree-sitter.

## Status

Version 0.1.0. The grammar reads whole LilyPond 2.26 files: the top-level forms, music, embedded Scheme and the LilyPond nested back inside it, and the lyric, markup, chord, figure and drum modes. It ships highlight, fold, indent and locals queries. It parses faster than [nwhetsell/tree-sitter-lilypond](https://github.com/nwhetsell/tree-sitter-lilypond) and catches more broken files, but it still shows an error in 432 of the 2,774 valid files in its test corpus, so it is not yet better overall, as the comparison below sets out. The names of the nodes the grammar produces, and the rules behind them, are fixed in [docs/nodes.md](docs/nodes.md).

## What it aims for

- **Agreement with LilyPond.** Every example in `test/corpus/` is a complete file, and a test runs LilyPond 2.26.0 on each one: it must accept every example except those marked `:error`, which it must reject. Every syntax fact the grammar encodes is checked against the compiler rather than taken from memory.
- **One tree for both languages.** Embedded Scheme, and LilyPond embedded inside that Scheme with `#{ #}`, parse into the same tree as the music around them.
- **Speed.** The grammar is measured against a fixed corpus of public scores, and a one-character edit in a large score must reparse within an editor's colouring budget.
- **Queries with no word lists.** The highlight, fold, indent and locals queries colour by the shape of the syntax, not by lists of LilyPond command names.

## Using it in Neovim

[nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter), on its `main` branch, installs a parser that is not on its own list from a snippet in a `User TSUpdate` autocommand. Neovim already gives `.ly` and `.ily` files the `lilypond` filetype, which matches the parser's name, so the parser needs no further registration. The second autocommand turns on Tree-sitter highlighting in each LilyPond buffer, which nvim-treesitter's `main` branch leaves to the user's configuration.

```lua
vim.api.nvim_create_autocmd('User', { pattern = 'TSUpdate',
  callback = function()
    require('nvim-treesitter.parsers').lilypond = {
      install_info = {
        url = 'https://github.com/anirbanchakraborty-dev/tree-sitter-lilypond',
        revision = 'v0.1.0',
        queries = 'queries',
      },
    }
  end,
})
vim.api.nvim_create_autocmd('FileType', { pattern = 'lilypond',
  callback = function() vim.treesitter.start() end,
})
```

Then run `:TSInstall lilypond` once. Building the parser needs the Tree-sitter CLI, version 0.26.1 or later, and a C compiler on the path, as every nvim-treesitter install does.

## Using it from Rust

```toml
[dependencies]
tree-sitter = "0.27.1"
tree-sitter-lilypond = { git = "https://github.com/anirbanchakraborty-dev/tree-sitter-lilypond", tag = "v0.1.0" }
```

The crate exposes the language as `tree_sitter_lilypond::LANGUAGE`, the node types as `NODE_TYPES`, and the four queries as `HIGHLIGHTS_QUERY`, `FOLDS_QUERY`, `INDENTS_QUERY` and `LOCALS_QUERY`.

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

## Speed

`cargo test --release --test speed -- --include-ignored --nocapture` times the parser in a release build. Each figure is the median of 20 runs after 3 warm-up runs, measured on 2026-10-24 on an Apple-silicon MacBook Pro. The 10,000-bar file repeats the music of the 100-bar test song a hundred times inside one pair of braces, and the reparse follows typing one `'` into a note in its middle bar.

| File | Full parse | One-character reparse |
| --- | --- | --- |
| 100 bars, 5,892 bytes | 0.40 ms | 0.02 ms |
| 10,000 bars, 292,992 bytes | 26.8 ms | 1.36 ms |

The test fails if the 100-bar file takes more than 5 ms to parse or 1 ms to reparse, if the 10,000-bar parse takes more than 110 times the 100-bar one, or if a reparse in the 10,000-bar file takes more than 2 ms. The reparse stays small because each bar ending in a bar check `|` is a hidden node of its own, so after an edit the parser reuses every untouched bar whole. Music written without bar checks gets no such grouping, and its reparse time grows with the length of the sequence: with the bar checks removed, the same reparse takes 2.6 ms at 1,000 bars and 20.9 ms at 10,000.

## Compared with nwhetsell/tree-sitter-lilypond

The grammar was measured on 2026-10-24 against the existing LilyPond grammar for Tree-sitter, [nwhetsell/tree-sitter-lilypond](https://github.com/nwhetsell/tree-sitter-lilypond) at commit `3d999a19c7b5ffb6e777ec6cbd56dc3a008bf169`, over 2,774 files that LilyPond 2.26.0 accepts and 36 files each broken in one known place. It was set to count as better only if it passed all three criteria below. It passes two and fails the first, so it is not yet better.

| Criterion | This grammar | nwhetsell | Result |
| --- | ---: | ---: | --- |
| Accepted files with an error, fewer is better | 432 | 2 | fails |
| Throughput, nwhetsell timed with its embedded Scheme grammar | 27,105 bytes/ms | 15,593 bytes/ms | passes |
| Broken files caught within one line of LilyPond's error | 30 of 36 | 16 of 36 | passes |

The two grammars sit at opposite ends of one trade. nwhetsell's accepts nearly everything, so it shows almost no false errors and misses most broken files. This one rejects what it does not recognise, so it catches more real mistakes and also flags valid LilyPond it has not yet learned to read, such as `\omit Staff.TimeSignature`, `f^(` and `\repeat "volta" 2`. The measured commit was `55874acfcc4f9bc72e5bbfca3cf3ba59e6c9b540`. The full report, with every broken file this grammar misses and why, and the accepted-file errors grouped by construct, is [docs/bench/verdict.md](https://github.com/anirbanchakraborty-dev/swara/blob/main/docs/bench/verdict.md) in the Swara repository.

## Licence

MIT. The grammar is written from LilyPond's documented behaviour and from what the compiler accepts. No code, queries, word lists or documentation are copied from LilyPond or from any other GPL project.
