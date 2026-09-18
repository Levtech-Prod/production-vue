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
    // The project list on the Offer Processing page. Kept here with the
    // sidebar's state for the same reason: a panel the user collapsed to make
    // room for a wide grid should still be collapsed the next time they open
    // the page.
    offerListCollapsed: localStorage.getItem('offerListCollapsed') === 'true',
  }),
  actions: {
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem('sidebarCollapsed', String(this.sidebarCollapsed));
    },
    toggleOfferList() {
      this.offerListCollapsed = !this.offerListCollapsed;
      localStorage.setItem('offerListCollapsed', String(this.offerListCollapsed));
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
