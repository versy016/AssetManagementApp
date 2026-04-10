import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const DEFAULT_SIZES = [25, 50, 100, 'All'];

/**
 * Reusable pagination bar for data tables.
 *
 * Props:
 *   page         – current 1-based page number
 *   pageSize     – current rows-per-page value (number or 'All')
 *   total        – total number of rows across all pages
 *   onPageChange       (newPage: number) => void
 *   onPageSizeChange   (newSize: number | 'All') => void
 *   pageSizes    – array of size options, default [25, 50, 100, 'All']
 */
export default function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = DEFAULT_SIZES,
}) {
  const isAll = pageSize === 'All';
  const totalPages = isAll ? 1 : Math.ceil(total / pageSize);
  const from = total === 0 ? 0 : (page - 1) * (isAll ? total : pageSize) + 1;
  const to = isAll ? total : Math.min(page * pageSize, total);

  return (
    <View style={styles.row}>
      {/* Left — rows-per-page selector */}
      <View style={styles.leftGroup}>
        <Text style={styles.label}>Rows per page:</Text>
        <View style={styles.sizeGroup}>
          {pageSizes.map(sz => {
            const active = sz === pageSize;
            return (
              <TouchableOpacity
                key={String(sz)}
                onPress={() => onPageSizeChange(sz)}
                style={[styles.sizeBtn, active && styles.sizeBtnActive]}
                accessibilityLabel={`${sz} rows per page`}
              >
                <Text style={[styles.sizeBtnText, active && styles.sizeBtnTextActive]}>
                  {sz}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Right — count + navigation */}
      <View style={styles.rightGroup}>
        <View style={styles.countBlock}>
          <Text style={styles.countPrimary}>
            {total === 0 ? '0' : `${from}–${to} of ${total}`}
          </Text>
          <Text style={styles.countSecondary}>
            Page {totalPages === 0 ? 1 : page} of {totalPages || 1}
          </Text>
        </View>
        <View style={styles.navGroup}>
          <TouchableOpacity
            disabled={page <= 1}
            onPress={() => onPageChange(page - 1)}
            style={[styles.navBtn, page <= 1 && styles.navBtnDisabled]}
            accessibilityLabel="Previous page"
          >
            <MaterialIcons
              name="chevron-left"
              size={20}
              color={page <= 1 ? '#CBD5E1' : '#0F172A'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            disabled={page >= totalPages}
            onPress={() => onPageChange(page + 1)}
            style={[styles.navBtn, page >= totalPages && styles.navBtnDisabled]}
            accessibilityLabel="Next page"
          >
            <MaterialIcons
              name="chevron-right"
              size={20}
              color={page >= totalPages ? '#CBD5E1' : '#0F172A'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  sizeGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  sizeBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#fff',
  },
  sizeBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  sizeBtnText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  sizeBtnTextActive: {
    color: '#2563EB',
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  countBlock: {
    alignItems: 'flex-end',
  },
  countPrimary: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '700',
    lineHeight: 18,
  },
  countSecondary: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
    lineHeight: 15,
  },
  navGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    borderColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
  },
});
