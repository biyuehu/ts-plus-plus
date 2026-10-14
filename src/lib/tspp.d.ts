/**
 * Compile-time-only numeric predicates provided by the
 * `standardLibraryPredicates` TS++ feature.
 *
 * These declarations let the checker type-check predicate calls in
 * `requires`, `ensures`, `predicate`, and `invariant` contexts. The
 * verification backend lowers the calls to SMT numeric operations and does
 * not emit JavaScript runtime functions.
 */
declare function isEven(value: bigint): boolean;
declare function isEven(value: number): boolean;
declare function isOdd(value: bigint): boolean;
declare function isOdd(value: number): boolean;
declare function isPositive(value: bigint): boolean;
declare function isPositive(value: number): boolean;
declare function isNonNegative(value: bigint): boolean;
declare function isNonNegative(value: number): boolean;
declare function isZero(value: bigint): boolean;
declare function isZero(value: number): boolean;
/** Returns true when `divisor` divides `value`. */
declare function divides(divisor: bigint, value: bigint): boolean;
declare function divides(divisor: number, value: number): boolean;
/** Returns true when `lower <= value <= upper`. */
declare function between(value: bigint, lower: bigint, upper: bigint): boolean;
declare function between(value: number, lower: number, upper: number): boolean;
