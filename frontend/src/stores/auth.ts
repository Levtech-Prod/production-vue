import { defineStore } from 'pinia';
import { api } from '../api/client';

export type User = {
  id: number;
  username: string;
  email: string;
  phone?: string;
  admin: boolean;
  createdAt: string;
};

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('user') || 'null') as User | null,
  }),
  getters: { isLoggedIn: (s) => !!s.user, isAdmin: (s) => !!s.user?.admin },
  actions: {
    async login(email: string, password: string) {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      this.user = data.user;
    },
    async signup(payload: {
      username: string;
      email: string;
      phone?: string;
      password: string;
      admin: boolean;
    }) {
      const { data } = await api.post('/auth/signup', payload);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      this.user = data.user;
    },
    logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      this.user = null;
    },
  },
});
