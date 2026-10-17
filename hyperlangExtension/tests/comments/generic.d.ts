export type Own = <T extends "*/HLE_NOTE_OWN/*">(value: T) => T;
export type Alias<T extends "*/HLE_NOTE_ALIAS/*"> = (value: T) => T;
export type Both<T extends "*/HLE_NOTE_OUTER/*"> = <U extends "*/HLE_NOTE_INNER/*">(outer: T, inner: U) => U;
export type Shadow<T extends "*/HLE_NOTE_SHADOW_OUTER/*"> = <T extends "*/HLE_NOTE_SHADOW_INNER/*">(value: T) => T;
export type Dependent<T extends "*/HLE_NOTE_DEPENDENT/*"> = <U extends T>(value: U) => T;
export type Parenthesized<T extends "*/HLE_NOTE_PAREN_OUTER/*"> = (<U extends "*/HLE_NOTE_PAREN_INNER/*">(value: U) => T);
export type Nested = () => <T extends "*/HLE_NOTE_NESTED/*">(value: T) => T;
export type PlainFunction = (value: number) => string;
