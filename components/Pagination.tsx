'use client'

import { useState, useMemo } from 'react'

export const PAGE_SIZE = 25

export function usePagination<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  )
  return { page: safePage, setPage, totalPages, paged, totalItems: items.length }
}

/** Compute visible page numbers with ellipsis gaps */
function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = [1]
  const left = Math.max(2, current - 1)
  const right = Math.min(total - 1, current + 1)
  if (left > 2) pages.push('...')
  for (let i = left; i <= right; i++) pages.push(i)
  if (right < total - 1) pages.push('...')
  pages.push(total)
  return pages
}

interface PaginationProps {
  page: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
  pageSize?: number
}

export default function Pagination({ page, totalPages, totalItems, onPageChange, pageSize = PAGE_SIZE }: PaginationProps) {
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalItems)
  const pages = getPageNumbers(page, totalPages)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3">
      {/* Item range */}
      <span className="text-xs text-neutral-600 tabular-nums">
        Showing {start}–{end} of {totalItems}
      </span>

      {/* Page controls */}
      <div className="flex items-center gap-1">
        {/* Prev */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2 py-1 rounded text-xs font-medium transition-colors duration-100 disabled:opacity-30 disabled:cursor-not-allowed text-neutral-400 hover:text-white hover:bg-white/[0.06]"
          aria-label="Previous page"
        >
          &lsaquo;
        </button>

        {/* Page numbers — hidden on small screens */}
        <div className="hidden sm:flex items-center gap-1">
          {pages.map((p, i) =>
            p === '...' ? (
              <span key={`e${i}`} className="px-1 text-xs text-neutral-700">...</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className="min-w-[28px] h-7 rounded text-xs font-semibold transition-colors duration-100"
                style={
                  p === page
                    ? { background: 'rgba(242,183,31,0.15)', color: '#F2B71F' }
                    : { color: '#737373' }
                }
              >
                {p}
              </button>
            ),
          )}
        </div>

        {/* Mobile: simple page indicator */}
        <span className="sm:hidden text-xs text-neutral-500 tabular-nums px-2">
          {page} / {totalPages}
        </span>

        {/* Next */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded text-xs font-medium transition-colors duration-100 disabled:opacity-30 disabled:cursor-not-allowed text-neutral-400 hover:text-white hover:bg-white/[0.06]"
          aria-label="Next page"
        >
          &rsaquo;
        </button>
      </div>
    </div>
  )
}
