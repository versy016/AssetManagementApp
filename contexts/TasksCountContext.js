// contexts/TasksCountContext.js
// Provides task count for the current user so the tab bar can show a badge.

import React from 'react';

export const TasksCountContext = React.createContext({
  taskCount: 0,
  setTaskCount: () => {},
});

export const TasksCountProvider = ({ children }) => {
  const [taskCount, setTaskCount] = React.useState(0);
  const value = React.useMemo(() => ({ taskCount, setTaskCount }), [taskCount]);
  return (
    <TasksCountContext.Provider value={value}>
      {children}
    </TasksCountContext.Provider>
  );
};

export const useTasksCount = () => React.useContext(TasksCountContext);
