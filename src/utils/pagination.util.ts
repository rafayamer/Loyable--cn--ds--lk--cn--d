// ================================================================

export interface PaginationOptions {
  page?:  number;
  limit?: number;
}

export interface PaginationMeta {
  page:       number;
  limit:      number;
  total:      number;
  totalPages: number;
  hasNext:    boolean;
  hasPrev:    boolean;
}

export const paginate = (opts: PaginationOptions): { skip: number; take: number; page: number; limit: number } => {
  const page  = Math.max(1, opts.page  ?? 1);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

export const paginationMeta = (
  total:  number,
  page:   number,
  limit:  number
): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  hasNext:    page * limit < total,
  hasPrev:    page > 1,
});
