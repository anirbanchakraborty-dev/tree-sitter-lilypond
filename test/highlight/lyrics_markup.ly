\version "2.26.0"

words = \lyricmode { Hel -- lo __ world }
%       ^ keyword
%                    ^ string
%                        ^ punctuation.delimiter
%                              ^ punctuation.delimiter
%                                 ^ string
\new Lyrics \lyricsto "melody" { la la }
%           ^ keyword
%                     ^ string
%                                ^ string
{ c'4 d' } \addlyrics { do re }
%          ^ keyword
%                       ^ string
title = \markup \bold { Hello "world" }
%       ^ keyword
%               ^ function.call
%                     ^ punctuation.bracket
%                       ^ string
%                             ^ string
lines = \markuplist { one two }
%       ^ keyword
%                     ^ string
said = "say \"hi\""
%      ^ string
%           ^ string.escape
{ c'4^\markup \italic dolce c'4_"sotto" }
%    ^ string
%     ^ keyword
%             ^ function.call
%                     ^ string
%                              ^ string
