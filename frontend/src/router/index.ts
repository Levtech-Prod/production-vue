import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import SignupView from '../views/SignupView.vue';
import DashboardView from '../views/DashboardView.vue';
import UsersView from '../views/UsersView.vue';
import PartCategoriesView from '../views/part-categories/PartCategoriesView.vue';
import PartsView from '../views/PartsView.vue';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: LoginView },
    { path: '/signup', component: SignupView },
    { path: '/dashboard', component: DashboardView, meta: { auth: true } },
    { path: '/users', component: UsersView, meta: { auth: true, admin: true } },
    {
      path: '/stock/categories',
      component: PartCategoriesView,
      meta: { auth: true, admin: true },
    },
    {
      path: '/stock/parts',
      component: PartsView,
      meta: { auth: true, admin: true },
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.auth && !auth.isLoggedIn) return '/login';
  if (to.meta.admin && !auth.isAdmin) return '/dashboard';
});

export default router;
