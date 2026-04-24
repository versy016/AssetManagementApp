// app/(tabs)/tasks.js
// Thin orchestrator — all logic lives in hooks/useTasks.js.

import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import { MaterialIcons } from '@expo/vector-icons';

import ScreenWrapper from '../../components/ui/ScreenWrapper';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import SearchInput from '../../components/ui/SearchInput';

import { useTasks } from '../../hooks/useTasks';
import TaskCard from '../../components/tasks/TaskCard';
import HireCard from '../../components/tasks/HireCard';
import TaskActionModal from '../../components/tasks/TaskActionModal';

export default function TasksScreen() {
  const {
    // Core
    loading,
    tasks,
    activeTab,
    setActiveTab,
    hires,
    hiresLoading,
    taskFilter,
    setTaskFilter,

    // Derived counts
    totalTasks,
    filteredTaskItems,

    // Task classifiers
    isOverdueTask,
    isReminderTask,
    isRepairTask,
    isServiceTask,

    // Modal open/action
    openTaskAction,

    // All modal state forwarded to TaskActionModal
    actionScrollRef,
    dateOpen,
    setDateOpen,
    actionOpen,
    setActionOpen,
    actionTask,
    actionNextDate,
    setActionNextDate,
    setNextMonths,
    actionSubmitting,
    actionDocSlug,
    actionDocPicked,
    setActionDocPicked,
    actionPhoto,
    setActionPhoto,
    actionNote,
    setActionNote,
    signoffReport,
    setSignoffReport,
    signoffChoice,
    setSignoffChoice,
    relevantDocName,
    setRelevantDocName,
    handleSubmitTaskAction,
  } = useTasks();

  const [query, setQuery] = useState('');

  const searchedTaskItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredTaskItems;
    return filteredTaskItems.filter((item) =>
      [item.assetId, item.model, item.assetTypeName, item.serialNumber, item.title]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [filteredTaskItems, query]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <ScreenWrapper style={styles.safeArea}>

      {/* ── Sub-tab bar (mobile native only) ── */}
      {Platform.OS !== 'web' && (
        <View style={styles.subTabBar}>
          {[
            { key: 'tasks', label: 'Tasks' },
            { key: 'hire',  label: 'Hire'  },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.subTab, activeTab === tab.key && styles.subTabActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.subTabText, activeTab === tab.key && styles.subTabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Hire list (mobile native only) ── */}
      {Platform.OS !== 'web' && activeTab === 'hire' && (
        <FlatList
          data={hires}
          keyExtractor={(h) => String(h.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={() => (
            <View style={styles.tasksHeaderRow}>
              <Text style={styles.sectionTitle}>Hire</Text>
              {hires.length > 0 && (
                <View style={styles.tasksHeaderChip}>
                  <MaterialIcons name="assignment" size={13} color={Colors.primary} />
                  <Text style={styles.tasksHeaderChipText}>
                    {hires.length} record{hires.length !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={() =>
            hiresLoading ? (
              <View style={styles.emptyWrap}><LoadingSpinner flex={false} size="large" /></View>
            ) : (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon="assignment"
                  iconColor={Colors.primary}
                  iconBg={Colors.primaryLight}
                  title="No hire records"
                  subtitle="Hire records will appear here once equipment has been hired out."
                />
              </View>
            )
          }
          renderItem={({ item }) => <HireCard item={item} />}
        />
      )}

      {/* ── Tasks list (always on web; tab-gated on native) ── */}
      {(Platform.OS === 'web' || activeTab === 'tasks') && (
        <FlatList
          data={tasks.loading ? [] : searchedTaskItems}
          keyExtractor={(t, idx) => {
            if (t.key) return String(t.key);
            if (t.actionId) return `action-${t.actionId}`;
            if (t.id) return `task-${t.id}`;
            const aid = t.assetId || t.asset_id || 'asset';
            const duePart = t.due ? +new Date(t.due) : 'nodue';
            return `${aid}-${duePart}-${idx}`;
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={() => (
            <View style={styles.tasksHeader}>
              <SearchInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by asset, ID, serial, type…"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.taskSearch}
              />
              <View style={styles.tasksHeaderRow}>
                <Text style={styles.sectionTitle}>Tasks</Text>
                {totalTasks > 0 && (
                  <View style={styles.tasksHeaderChip}>
                    <MaterialIcons name="assignment-turned-in" size={14} color={Colors.primary} />
                    <Text style={styles.tasksHeaderChipText}>
                      {searchedTaskItems.length !== totalTasks
                        ? `${searchedTaskItems.length} of ${totalTasks}`
                        : `${totalTasks} open`}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={() =>
            tasks.loading ? (
              <View style={styles.emptyWrap}><LoadingSpinner flex={false} size="large" /></View>
            ) : (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon="celebration"
                  iconColor={Colors.primary}
                  iconBg={Colors.primaryLight}
                  title="You're all caught up"
                  subtitle={`No ${taskFilter === 'all' ? '' : `${taskFilter} `}tasks right now.`}
                  hint="Tip: Scan an asset to log new work."
                />
              </View>
            )
          }
          renderItem={({ item }) => {
            const isOverdue   = isOverdueTask(item);
            const isReminder  = isReminderTask(item);
            const isRepair    = isRepairTask(item);
            const isService   = isServiceTask(item) && !isRepair;
            const isSignoff   = item.kind === 'signoff';

            return (
              <TaskCard
                item={item}
                isOverdue={isOverdue}
                isReminder={isReminder}
                isRepair={isRepair}
                isService={isService}
                isSignoff={isSignoff}
                onAction={() => openTaskAction(item)}
              />
            );
          }}
        />
      )}

      {/* ── Action modal ── */}
      <TaskActionModal
        actionOpen={actionOpen}
        setActionOpen={setActionOpen}
        actionTask={actionTask}
        dateOpen={dateOpen}
        setDateOpen={setDateOpen}
        actionNextDate={actionNextDate}
        setActionNextDate={setActionNextDate}
        setNextMonths={setNextMonths}
        actionDocSlug={actionDocSlug}
        actionDocPicked={actionDocPicked}
        setActionDocPicked={setActionDocPicked}
        actionPhoto={actionPhoto}
        setActionPhoto={setActionPhoto}
        actionNote={actionNote}
        setActionNote={setActionNote}
        signoffReport={signoffReport}
        setSignoffReport={setSignoffReport}
        signoffChoice={signoffChoice}
        setSignoffChoice={setSignoffChoice}
        relevantDocName={relevantDocName}
        setRelevantDocName={setRelevantDocName}
        actionSubmitting={actionSubmitting}
        handleSubmitTaskAction={handleSubmitTaskAction}
        actionScrollRef={actionScrollRef}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bg },
  listContent: { padding: 14, paddingBottom: 24 },
  emptyWrap: { alignItems: 'center', paddingVertical: 40 },

  // ── Header ──────────────────────────────────────────────────────────────
  tasksHeader: { marginBottom: 4 },
  taskSearch: { marginBottom: 10 },
  tasksHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: sf(18),
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tasksHeaderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.primaryLight,
    borderWidth: 2,
    borderColor: Colors.line,
    gap: 5,
  },
  tasksHeaderChipText: { fontSize: sf(12), fontWeight: '800', color: Colors.primary },

  // ── Sub-tab bar ──────────────────────────────────────────────────────────
  subTabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderBottomWidth: 2,
    borderBottomColor: Colors.line,
    paddingHorizontal: 8,
  },
  subTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  subTabActive: { borderBottomColor: Colors.accent },
  subTabText: {
    fontSize: sf(12),
    fontWeight: '800',
    color: Colors.sub2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  subTabTextActive: { color: Colors.accent },
});
