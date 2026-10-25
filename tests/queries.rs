//! The four queries compile against the grammar, use only the captures the
//! plugin and nvim-treesitter expect, and carry no LilyPond word lists. The
//! node contract in `docs/nodes.md` names only nodes and fields that exist.

mod common;

use tree_sitter::{Language, Query};
use tree_sitter_lilypond::{
    FOLDS_QUERY, HIGHLIGHTS_QUERY, INDENTS_QUERY, LOCALS_QUERY, NODE_TYPES,
};

/// The highlight captures, one per row of the mapping in the grammar plan.
const HIGHLIGHT_CAPTURES: &[&str] = &[
    "comment",
    "string",
    "string.escape",
    "string.special.path",
    "number",
    "variable",
    "variable.member",
    "operator",
    "constant.builtin",
    "function.call",
    "keyword",
    "keyword.import",
    "attribute.builtin",
    "attribute",
    "type",
    "property",
    "boolean",
    "character",
    "string.special.symbol",
    "punctuation.special",
    "punctuation.bracket",
    "punctuation.delimiter",
];

/// The one pattern on text a query may hold, the shape of a dynamic such as
/// `\ff`, as it is written inside a query string.
const DYNAMICS_PATTERN: &str = r#""^\\\\[fmprsz]+$""#;

/// Each query's file name, its text and the captures it may use.
fn queries() -> [(&'static str, &'static str, &'static [&'static str]); 4] {
    [
        ("highlights.scm", HIGHLIGHTS_QUERY, HIGHLIGHT_CAPTURES),
        ("folds.scm", FOLDS_QUERY, &["fold"]),
        (
            "indents.scm",
            INDENTS_QUERY,
            &["indent.begin", "indent.branch", "indent.end"],
        ),
        (
            "locals.scm",
            LOCALS_QUERY,
            &["local.scope", "local.definition.var"],
        ),
    ]
}

fn language() -> Language {
    tree_sitter_lilypond::LANGUAGE.into()
}

/// `Query::new` rejects a node or token name the grammar does not have, so
/// compiling proves every name a query uses exists.
#[test]
fn queries_compile() {
    for (name, source, _) in queries() {
        assert!(!source.trim().is_empty(), "{name} is empty");
        if let Err(error) = Query::new(&language(), source) {
            panic!("{name}: {error}");
        }
    }
}

#[test]
fn captures_are_allowed() {
    for (name, source, allowed) in queries() {
        let query = Query::new(&language(), source).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(query.capture_names().len() > 0, "{name} captures nothing");
        for capture in query.capture_names() {
            assert!(
                allowed.contains(capture),
                "{name}: @{capture} is not one of {allowed:?}"
            );
        }
    }
}

/// A predicate that compares text with a literal is how a word list gets in,
/// so the only literal allowed is the dynamics pattern, in `#match?` or
/// `#not-match?`. `#eq?` may compare two captures, and `#set!` sets a
/// property such as a priority.
#[test]
fn no_word_lists() {
    for (name, source, _) in queries() {
        assert!(!source.contains("any-of?"), "{name} uses #any-of?");
        for (at, _) in source.match_indices("(#") {
            let rest = &source[at + 2..];
            let end = rest.find(')').unwrap_or(rest.len());
            let (predicate, arguments) = rest[..end]
                .split_once(char::is_whitespace)
                .unwrap_or((&rest[..end], ""));
            match predicate {
                "set!" => {}
                "match?" | "not-match?" => {
                    let literal = arguments.trim().split_once(char::is_whitespace).map(|p| p.1);
                    assert_eq!(
                        literal.map(str::trim),
                        Some(DYNAMICS_PATTERN),
                        "{name}: #{predicate} {arguments}"
                    );
                }
                "eq?" | "not-eq?" => assert!(
                    !arguments.contains('"'),
                    "{name}: #{predicate} compares with a literal: {arguments}"
                ),
                other => panic!("{name}: #{other} is not allowed"),
            }
        }
    }
}

/// The text of `docs/nodes.md` from `heading` to the next heading.
fn section<'a>(doc: &'a str, heading: &str) -> &'a str {
    let start = doc.find(heading).unwrap_or_else(|| panic!("no {heading}")) + heading.len();
    let end = doc[start..].find("\n## ").map_or(doc.len(), |i| start + i);
    &doc[start..end]
}

fn is_name(text: &str) -> bool {
    text.starts_with(|c: char| c.is_ascii_lowercase())
        && text.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

fn is_node(kind: &str) -> bool {
    NODE_TYPES.contains(&format!("\n    \"type\": \"{kind}\",\n    \"named\": true"))
}

fn is_field(field: &str) -> bool {
    NODE_TYPES.contains(&format!("\n      \"{field}\": {{"))
}

/// Every name the contract gives in backticks, such as `note` or
/// `pitch: pitch`, is a named node or a field in `src/node-types.json`.
#[test]
fn contract_nodes_exist() {
    let doc = std::fs::read_to_string(common::root().join("docs/nodes.md")).unwrap();
    let names = section(&doc, "## The names");
    let mut checked = 0;
    for span in names.split('`').skip(1).step_by(2) {
        match span.split(": ").collect::<Vec<_>>()[..] {
            [name] if is_name(name) => {
                assert!(is_node(name) || is_field(name), "`{name}` is neither a node nor a field");
            }
            [field, kind] if is_name(field) && is_name(kind) => {
                assert!(is_field(field), "`{field}` is not a field");
                assert!(is_node(kind), "`{kind}` is not a node");
            }
            _ => continue,
        }
        checked += 1;
    }
    assert!(checked > 100, "only {checked} names checked");
}
