export interface InvalidInTypeScript<F: Type => Type> {
    value: F<string>;
}
