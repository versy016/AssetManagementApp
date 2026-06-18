// app/(tabs)/tasks.js
// Thin orchestrator — all logic lives in hooks/useTasks.js.

import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from 'react-native';
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
import CreateTaskModal from '../../components/tasks/CreateTaskModal';
import CompleteTaskModal from '../../components/tasks/CompleteTaskModal';
import NewButton from '../../components/ui/NewButton';

export default function TasksScreen() {
  const {
    // Core
    loading,
    tasks,
    canAdmin,
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

    // Manual tasks
    createManualTask,
    updateManualTask,
    completeManualTask,
    dismissManualTask,
  } = useTasks();

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);     // manual task being edited
  const [completeTarget, setCompleteTarget] = useState(null); // manual task being signed off

  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  // Responsive columns: desktop web gets a denser multi-column grid.
  const cols = isWeb ? (width >= 1280 ? 3 : width >= 820 ? 2 : 1) : 1;

  const searchedTaskItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredTaskItems;
    return filteredTaskItems.filter((item) =>
      [item.assetId, item.model, item.assetTypeName, item.serialNumber, item.title]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [filteredTaskItems, query]);

  // Pad the grid with invisible placeholders so the last row keeps card widths
  // consistent (otherwise a lone trailing card stretches full width).
  const gridData = useMemo(() => {
    if (cols <= 1) return searchedTaskItems;
    const arr = [...searchedTaskItems];
    const rem = arr.length % cols;
    if (rem) for (let i = 0; i < cols - rem; i++) arr.push({ _ph: true, key: `ph-${i}` });
    return arr;
  }, [searchedTaskItems, cols]);

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
              <Text style={styles.sectionTitle}>Active Hires</Text>
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
          key={`tasks-cols-${cols}`}
          data={tasks.loading ? [] : gridData}
                  keyExtractor={(t, idx) => {
                    if (t.key) return String(t.key);
                    if (t.actionId) return `action-${t.actionId}`;
                    if (t.id) return `task-${t.id}`;
                    const aid = t.assetId || t.asset_id || 'asset';
                    const duePart = t.due ? +new Date(t.due) : 'nodue';
                    return `${aid}-${duePart}-${idx}`;
                  }}
          numColumns={cols}
          columnWrapperStyle={cols > 1 ? styles.colWrap : undefined}
          contentContainerStyle={[styles.listContent, isWeb && styles.listContentWeb]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={cols > 1 ? null : () => <View style={{ height: 10 }} />}
          ListHeaderComponent={() => (
            <View style={styles.tasksHeader}>
              {/* Heading row first — title + count chip + New task */}
              <View style={styles.tasksHeaderRow}>
                <Text style={styles.sectionTitle}>Tasks &amp; Reminders</Text>
                <View style={styles.tasksHeaderRight}>
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
                  <NewButton label="New task" onPress={() => setCreateOpen(true)} />
                </View>
              </View>
              {/* Search below the heading */}
              <SearchInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by asset, ID, serial, type…"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.taskSearch}
              />
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
            // Invisible spacer to keep the last grid row's card widths even.
            if (item._ph) return <View style={cols > 1 ? styles.gridCell : undefined} />;
            const isOverdue   = isOverdueTask(item);
            const isReminder  = isReminderTask(item);
            const isRepair    = isRepairTask(item);
            const isService   = isServiceTask(item) && !isRepair;
            const isSignoff   = item.kind === 'signoff';

            const card = (
              <TaskCard
                item={item}
                isOverdue={isOverdue}
                isReminder={isReminder}
                isRepair={isRepair}
                isService={isService}
                isSignoff={isSignoff}
                onAction={() => openTaskAction(item)}
                onComplete={() => setCompleteTarget(item)}
                onEdit={() => setEditTarget(item)}
                onDismiss={() => dismissManualTask(item.taskId)}
              />
            );
            return cols > 1 ? <View style={styles.gridCell}>{card}</View> : card;
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

      {/* ── Create / edit task modal ── */}
      <CreateTaskModal
        visible={createOpen || !!editTarget}
        editTask={editTarget}
        onClose={() => { setCreateOpen(false); setEditTarget(null); }}
        onCreate={createManualTask}
        onUpdate={updateManualTask}
        isAdmin={canAdmin}
      />

      {/* ── Complete (sign-off) modal ── */}
      <CompleteTaskModal
        visible={!!completeTarget}
        task={completeTarget}
        onClose={() => setCompleteTarget(null)}
        onComplete={completeManualTask}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bg },
  listContent: { padding: 14, paddingBottom: 24 },
  // Web: centre + cap width, and give the grid a touch more breathing room.
  listContentWeb: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 8 },
  colWrap: { gap: 14, marginBottom: 14 },
  gridCell: { flex: 1 },
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
  tasksHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newTaskBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: Colors.primary,
  },
  newTaskBtnText: { fontSize: sf(12), fontWeight: '900', color: '#fff' },

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
