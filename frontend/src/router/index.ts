import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import SignupView from '../views/SignupView.vue';
import DashboardView from '../views/DashboardView.vue';
import UsersView from '../views/UsersView.vue';
import PartCategoriesView from '../views/part-categories/PartCategoriesView.vue';
import PartsView from '../views/parts/PartsView.vue';
import ProductsListView from '../views/products/ProductsListView.vue';
import ProductDetailView from '../views/products/ProductDetailView.vue';
import ProductTypesView from '../views/settings/ProductTypesView.vue';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: LoginView, meta: { guestOnly: true } },
    { path: '/signup', component: SignupView, meta: { guestOnly: true } },
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
    {
      path: '/products',
      component: ProductsListView,
      meta: { auth: true },
    },
    {
      path: '/products/:id',
      component: ProductDetailView,
      meta: { auth: true },
    },
    {
      path: '/settings/product-types',
      component: ProductTypesView,
      meta: { auth: true, admin: true },
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();

  // Route requires a logged-in user: send anonymous visitors to Login,
  // remembering where they were headed so we can return them afterwards.
  if (to.meta.auth && !auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  // Route requires admin rights: logged-in non-admins are bounced to the dashboard.
  if (to.meta.admin && !auth.isAdmin) {
    return '/dashboard';
  }

  // Guest-only route (Login/Signup): an already-logged-in user gets sent
  // straight to whatever page they were trying to reach (or the dashboard).
  if (to.meta.guestOnly && auth.isLoggedIn) {
    const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/dashboard';
    return redirect;
  }
});

export default router;
