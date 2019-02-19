interface FuzzyOptions {
  caseSensitive?: boolean;
  sort?: boolean;
}
declare class FuzzySearch<T> {
  constructor(haystack: T[], keys: string[], options?: FuzzyOptions);
  search(needle: string): T[];
}
declare module "fuzzy-search" {
  export = FuzzySearch;
}
