\version "2.26.0"
\include "english.ly"
% <- keyword.import
%        ^ string.special.path
\language "english"
% <- keyword.import
%         ^ string
% A line comment.
% <- comment
%{ A block comment. %}
% <- comment

\header {
% <- keyword
  title = "Song"
% ^ variable.member
%         ^ string
}
\paper {
% <- keyword
  indent = 0
% ^ variable.member
%          ^ number
}
verse.1 = \lyricmode { one }
% <- variable.member
\layout {
% <- keyword
  \context { \Staff
% ^ keyword
%          ^ punctuation.bracket
%            ^ type
    \remove "Time_signature_engraver"
%   ^ keyword
%           ^ string
  }
}
\book {
% <- keyword
  \bookpart {
% ^ keyword
    \score {
      { c'1 }
      \midi { }
%     ^ keyword
    }
  }
}
