/**
 * @deprecated Prefer importing from `src/common/dto/pagination.dto.ts`,
 * which provides a Swagger-aware class for response schemas.
 *
 * Kept here so existing consumers that import `PaginationMetaFormat`
 * still compile (BE-15 acceptance: consistent metadata across pages).
 */
export interface PaginationMetaFormat {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface PaginatedResponse<T> {
  message: string;
  items: T[];
  meta: PaginationMetaFormat;
  totalAmount: string;
}
