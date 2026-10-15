# TSPP TODOs & Proposals

## Type Universes / Kind Checking

- **Kind checking and inference for `data` and `newtype` declarations in type universes**:
  - Example: `data Maybe<T>: Type = Nothing | Just(value: T);`
  - In type universes (`typeUniverses`), `data` and `newtype` declarations currently allow kind annotations (e.g. `: Type` or `: Type -> Type`), but kind checking is not strictly enforced or kind inference is incomplete.
  - Unlike `type X = ...` where the default kind can intuitively be `Type` (and explicitly altered by the user if higher-kinded), `data` and `newtype` define type constructors where parameter kinds and constructor kinds interact.
  - Design decision and implementation pending: determine kind inference and check rules for `data` / `newtype` type constructors.

