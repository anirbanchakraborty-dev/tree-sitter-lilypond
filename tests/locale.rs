//! The tree must not depend on the process locale. An editor such as Neovim
//! sets the locale from the environment, where the C library counts spaces
//! beyond ASCII as whitespace, while `tree-sitter test` keeps the C locale,
//! where it does not. LilyPond's own whitespace is ASCII, so a no-break space
//! or an ideographic space inside a word is part of the word in both.
//!
//! This file is its own test binary because the locale is process-wide.

use std::ffi::{CString, c_char, c_int};

unsafe extern "C" {
    fn setlocale(category: c_int, locale: *const c_char) -> *mut c_char;
}

#[cfg(target_os = "linux")]
const LC_ALL: c_int = 6;
#[cfg(not(target_os = "linux"))]
const LC_ALL: c_int = 0;

fn use_a_utf8_locale() -> bool {
    ["en_US.UTF-8", "C.UTF-8", "UTF-8", ".UTF-8"].iter().any(|name| {
        let name = CString::new(*name).unwrap();
        // SAFETY: the name is a valid C string, and no other thread runs in
        // this binary while the locale changes.
        unsafe { !setlocale(LC_ALL, name.as_ptr()).is_null() }
    })
}

fn count(node: tree_sitter::Node, kind: &str) -> usize {
    let mut cursor = node.walk();
    let below: usize = node.children(&mut cursor).map(|child| count(child, kind)).sum();
    below + usize::from(node.kind() == kind)
}

#[test]
fn words_do_not_depend_on_the_locale() {
    assert!(use_a_utf8_locale(), "no UTF-8 locale is installed");
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_lilypond::LANGUAGE.into())
        .unwrap();
    for space in ['\u{a0}', '\u{3000}'] {
        for (source, kind) in [
            (format!("\\lyricmode {{ a{space}b }}"), "lyric_word"),
            (format!("\\markup {{ a{space}b }}"), "markup_word"),
        ] {
            let tree = parser.parse(&source, None).unwrap();
            let root = tree.root_node();
            assert!(!root.has_error(), "{source:?}: {}", root.to_sexp());
            assert_eq!(count(root, kind), 1, "{source:?}: {}", root.to_sexp());
        }
    }
}
