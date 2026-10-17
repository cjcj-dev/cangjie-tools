/** HLE_CONTROL_DOC ordinary documentation. */
export type Plain = string;
// HLE_CONTROL_LINE ordinary line comment.
export declare const ORDINARY = 17;
export declare function echo(value: string): string;
export interface PlainObject {
    /** HLE_CONTROL_PROPERTY ordinary property. */
    value: string;
    method(value: number): boolean;
}
export declare enum PlainEnum { Zero = 0, One = 1 }
