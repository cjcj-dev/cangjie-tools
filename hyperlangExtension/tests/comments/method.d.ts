export declare function note(value: "*/HLE_NOTE_METHOD/*"): void;
/** @since 1.0.0
 * Ordinary block documentation.
 */
export declare function documented(value: "*/HLE_NOTE_METHOD_SINCE/*"): "*/HLE_NOTE_METHOD_RETURN/*";
export interface NoteMethods {
    method(value: "*/HLE_NOTE_OBJECT_METHOD/*"): void;
}
export declare function promised(value: "*/HLE_NOTE_PROMISE_METHOD/*"): Promise<string>;
export declare function on(key: "*/HLE_NOTE_EVENT_ON/*", callback: (value: string) => void): void;
export declare function off(key: "*/HLE_NOTE_EVENT_OFF/*", callback: (value: string) => void): void;
export declare function unionReturn(): "*/HLE_NOTE_UNION_RETURN/*" | number;
export declare class NoteClass {
    constructor(value: "*/HLE_NOTE_CONSTRUCTOR/*");
    static method(value: "*/HLE_NOTE_STATIC_METHOD/*"): void;
    promised(value: "*/HLE_NOTE_MEMBER_PROMISE/*"): Promise<string>;
    on(event: "*/HLE_NOTE_MEMBER_ON/*", callback: (value: string) => void): void;
    off(event: "*/HLE_NOTE_MEMBER_OFF/*", callback?: (value: string) => void): void;
}
export declare class StaticEvents {
    static on(event: "*/HLE_NOTE_STATIC_ON/*", callback: (value: string) => void): void;
    static off(event: "*/HLE_NOTE_STATIC_OFF/*", callback?: (value: string) => void): void;
}
/** @deprecated ordinary disabled interface. */
export interface DisabledNote {
    value: "*/HLE_NOTE_DISABLED_INTERFACE/*";
}
