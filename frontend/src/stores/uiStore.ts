import { defineStore } from 'pinia';

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true',
    // Sidebar nav groups the user has manually expanded or collapsed, keyed
    // by the group's root path. A group also auto-expands while the current
    // route sits under its root; this only tracks the manual override.
    openSidebarGroups: JSON.parse(
      localStorage.getItem('openSidebarGroups') || '[]',
    ) as string[],
  }),
  actions: {
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem('sidebarCollapsed', String(this.sidebarCollapsed));
    },
    toggleSidebarGroup(rootPath: string) {
      const index = this.openSidebarGroups.indexOf(rootPath);
      if (index === -1) {
        this.openSidebarGroups.push(rootPath);
      } else {
        this.openSidebarGroups.splice(index, 1);
      }
      localStorage.setItem('openSidebarGroups', JSON.stringify(this.openSidebarGroups));
    },
  },
});
