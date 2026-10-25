//! Where the parse error lands after a common slip, a brace left open or one
//! deleted. Every note must still read as a note, so that the colours and
//! folds of the music survive while the slip is fixed.
//!
//! The tests do not ask for the same number of notes. A note name is any word,
//! and LilyPond accepts `a = b` in music as the note `a` with an octave check,
//! so inside a brace left open the line `words = \lyricmode {` reads as one
//! more note until the brace is closed.

mod common;

use tree_sitter::{Node, Tree};

fn song() -> String {
    std::fs::read_to_string(common::root().join("test/fixtures/song-100.ly"))
        .expect("song-100.ly exists")
}

/// What the recovery tests count in a tree.
#[derive(Debug, Default)]
struct Census {
    /// The start byte of every `note` node.
    notes: Vec<usize>,
    /// The start byte of every `ERROR` node.
    errors: Vec<usize>,
    missing_braces: usize,
}

fn census(tree: &Tree) -> Census {
    fn walk(node: Node, out: &mut Census) {
        if node.is_error() {
            out.errors.push(node.start_byte());
        } else if node.is_missing() && node.kind() == "}" {
            out.missing_braces += 1;
        } else if node.kind() == "note" {
            out.notes.push(node.start_byte());
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            walk(child, out);
        }
    }
    let mut out = Census::default();
    walk(tree.root_node(), &mut out);
    out
}

fn parse(text: &str) -> Census {
    census(&common::parser().parse(text, None).expect("parses"))
}

/// The notes of `before` that are not notes in `after`, an edit at `at` that
/// deleted `delete` bytes and inserted `insert` bytes having moved them.
fn lost(before: &Census, after: &Census, at: usize, delete: usize, insert: usize) -> Vec<usize> {
    let moved = |start: usize| if start < at { start } else { start - delete + insert };
    before.notes.iter().copied().filter(|&start| !after.notes.contains(&moved(start))).collect()
}

#[test]
fn unclosed_brace_keeps_music() {
    let text = song();
    let before = parse(&text);
    assert!(before.errors.is_empty() && before.missing_braces == 0, "{before:?}");
    let at: usize = text.split_inclusive('\n').take(10).map(str::len).sum();
    let (edited, _) = common::edit_for(&text, at, 0, "{");
    let after = parse(&edited);
    assert_eq!(after.missing_braces, 1, "{after:?}");
    assert!(after.errors.is_empty(), "{after:?}");
    assert_eq!(lost(&before, &after, at, 0, 1), Vec::<usize>::new());
}

#[test]
fn deleted_brace_keeps_music() {
    let text = song();
    let before = parse(&text);
    let at = text.find('}').expect("a closing brace");
    let (edited, _) = common::edit_for(&text, at, 1, "");
    let after = parse(&edited);
    assert_eq!(lost(&before, &after, at, 1, 0), Vec::<usize>::new());
    assert!(after.errors.iter().all(|&start| start >= at), "deleted at {at}: {after:?}");
}
