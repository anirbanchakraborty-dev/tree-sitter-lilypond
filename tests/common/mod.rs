//! Helpers shared by the integration tests.

#![allow(dead_code)]

use std::fmt::Write;
use std::path::{Path, PathBuf};

use tree_sitter::{InputEdit, Node, Parser, Point, Tree};

/// One example from `test/corpus/*.txt`.
pub struct CorpusCase {
    /// The corpus file's name, such as `comments.txt`.
    pub file: String,
    /// The example's title.
    pub name: String,
    /// The LilyPond text between the title block and the `---` divider.
    pub input: String,
    /// True when the title block carries `:error`.
    pub expects_error: bool,
    /// True when the input's first line is `% agree: skip, ...`, for an
    /// example LilyPond cannot judge on its own, such as one that includes
    /// a file the corpus does not have.
    pub skip: bool,
}

/// The repository root.
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Every example in `test/corpus/*.txt`, in file then document order.
pub fn corpus_cases() -> Vec<CorpusCase> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(root().join("test/corpus"))
        .expect("test/corpus exists")
        .map(|entry| entry.expect("readable corpus folder").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "txt"))
        .collect();
    files.sort();
    files.iter().flat_map(|path| parse_corpus_file(path)).collect()
}

/// Is this line a run of three or more of `c`, such as `===` or `---`?
fn is_rule(line: &str, c: char) -> bool {
    let line = line.trim_end_matches(['\r', '\n']);
    line.len() >= 3 && line.chars().all(|ch| ch == c)
}

fn parse_corpus_file(path: &Path) -> Vec<CorpusCase> {
    let text = std::fs::read_to_string(path).expect("corpus files are UTF-8");
    let file = path.file_name().unwrap().to_string_lossy().into_owned();
    // Keep each line's ending, so that a carriage return inside an example
    // reaches LilyPond exactly as it reaches the parser.
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut cases = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if !is_rule(lines[i], '=') {
            i += 1;
            continue;
        }
        let name = lines.get(i + 1).map_or("", |l| l.trim()).to_string();
        i += 2;
        let mut expects_error = false;
        while i < lines.len() && !is_rule(lines[i], '=') {
            expects_error |= lines[i].trim() == ":error";
            i += 1;
        }
        i += 1;
        let start = i;
        while i < lines.len() && !is_rule(lines[i], '-') && !is_rule(lines[i], '=') {
            i += 1;
        }
        let input = lines[start..i].concat();
        let input = input.trim_matches('\n').to_string();
        let skip = input.starts_with("% agree: skip");
        cases.push(CorpusCase {
            file: file.clone(),
            name,
            input,
            expects_error,
            skip,
        });
        // Step over the expected tree to the next title block.
        while i < lines.len() && !is_rule(lines[i], '=') {
            i += 1;
        }
    }
    cases
}

/// A parser set to LilyPond.
pub fn parser() -> Parser {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_lilypond::LANGUAGE.into())
        .expect("the grammar's ABI matches the library");
    parser
}

/// The point at byte `offset` of `text`: its row, and its column in bytes.
pub fn point_at(text: &str, offset: usize) -> Point {
    let before = &text.as_bytes()[..offset];
    let row = before.iter().filter(|&&b| b == b'\n').count();
    let column = before.iter().rev().take_while(|&&b| b != b'\n').count();
    Point { row, column }
}

/// `src` with `delete` bytes at `at` replaced by `insert`, and the edit that
/// tells an old tree about the change.
pub fn edit_for(src: &str, at: usize, delete: usize, insert: &str) -> (String, InputEdit) {
    let edited = format!("{}{insert}{}", &src[..at], &src[at + delete..]);
    let edit = InputEdit {
        start_byte: at,
        old_end_byte: at + delete,
        new_end_byte: at + insert.len(),
        start_position: point_at(src, at),
        old_end_position: point_at(src, at + delete),
        new_end_position: point_at(&edited, at + insert.len()),
    };
    (edited, edit)
}

/// Every node in `tree`, one per line and indented by depth, with its field
/// name, kind, byte range and whether it is missing. Unlike `to_sexp`, this
/// shows a node whose text moved by a byte, and the anonymous tokens.
pub fn dump(tree: &Tree) -> String {
    fn walk(node: Node, field: Option<&str>, depth: usize, out: &mut String) {
        let missing = if node.is_missing() { " MISSING" } else { "" };
        let field = field.map_or(String::new(), |f| format!("{f}: "));
        let (start, end) = (node.start_byte(), node.end_byte());
        writeln!(out, "{:depth$}{field}{:?} {start}..{end}{missing}", "", node.kind()).unwrap();
        let mut cursor = node.walk();
        if cursor.goto_first_child() {
            loop {
                walk(cursor.node(), cursor.field_name(), depth + 2, out);
                if !cursor.goto_next_sibling() {
                    break;
                }
            }
        }
    }
    let mut out = String::new();
    walk(tree.root_node(), None, 0, &mut out);
    out
}

/// Replace `delete` bytes at `at` in `src` with `insert`, then parse the
/// edited text twice: once reusing the tree of `src`, as an editor does, and
/// once from nothing. Returns the two dumps, incremental first.
pub fn edit_and_reparse(src: &str, at: usize, delete: usize, insert: &str) -> (String, String) {
    let mut parser = parser();
    let mut old = parser.parse(src, None).expect("parses");
    let (edited, edit) = edit_for(src, at, delete, insert);
    old.edit(&edit);
    let incremental = parser.parse(&edited, Some(&old)).expect("reparses");
    let fresh = parser.parse(&edited, None).expect("parses");
    (dump(&incremental), dump(&fresh))
}
