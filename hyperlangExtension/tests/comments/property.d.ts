export interface PropertyFields {
    // */ HLE_NOTE_FIELD_REQUIRED /* harmless delimiter text.
    required: string;
    // */ HLE_NOTE_FIELD_READONLY /* harmless delimiter text.
    readonly immutable: number;
    // */ HLE_NOTE_FIELD_OPTIONAL /* harmless delimiter text.
    optional?: boolean;
    /** HLE_CONTROL_FIELD_DOC ordinary documentation. */
    readonly documented?: string;
}
export interface ChildFields extends PropertyFields {
    // */ HLE_NOTE_FIELD_CHILD /* harmless delimiter text.
    child: number;
}
export interface PropertyAccessors extends PropertyFields {
    // */ HLE_NOTE_PROP_REQUIRED /* harmless delimiter text.
    local: string;
    // */ HLE_NOTE_PROP_OPTIONAL /* harmless delimiter text.
    readonly localOptional?: boolean;
    act(): void;
}
export declare class PropertyClass {
    // */ HLE_NOTE_PROP_STATIC /* harmless delimiter text.
    static shared: string;
    // */ HLE_NOTE_PROP_READONLY /* harmless delimiter text.
    readonly fixed: number;
    // */ HLE_NOTE_PROP_MUTABLE /* harmless delimiter text.
    mutable?: string;
    /** HLE_CONTROL_PROP_DOC ordinary documentation. */
    documented: boolean;
}
export declare class ChildClass extends PropertyClass {
    // */ HLE_NOTE_PROP_CHILD /* harmless delimiter text.
    child: boolean;
}
