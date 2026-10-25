\version "2.26.0"

size = #(+ 1 2.5)
%      ^ punctuation.special
%       ^ punctuation.bracket
%        ^ function.call
%          ^ number
%            ^ number
%               ^ punctuation.bracket
label = #"a b"
%        ^ string
flag = ##t
%       ^ boolean
letter = ##\a
%         ^ character
key = ##:key
%      ^ string.special.symbol
sym = #'sym
%      ^ punctuation.special
%       ^ variable
items = #`(1 ,size ,@(list 2 3))
%        ^ punctuation.special
%            ^ punctuation.special
%             ^ variable
%                  ^ punctuation.special
%                     ^ function.call
vec = #(vector 1 #(2 3))
%       ^ function.call
%                ^ punctuation.bracket
dollar = $(list 1)
%        ^ punctuation.special
music = #(list #{ c'4 #})
%              ^ punctuation.special
%                 ^ variable
%                     ^ punctuation.special
nested = ##{ c'4 #}
%         ^ punctuation.special
%                ^ punctuation.special
expr = #(begin ; a note
;              ^ comment
  #| block |# #;(ignored) 1
; ^ comment
;             ^ comment
  )
