export interface InvalidInTypeScript<F: Type => Type> {
    value: F<string>;
}

export type InvalidAliasInTypeScript: Type => Type = Array;
