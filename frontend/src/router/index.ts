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
import ProjectsView from '../views/projects/ProjectsView.vue';
import OfferProcessingView from '../views/projects/offers/OfferProcessingView.vue';
import { useAuthStore } from '../stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    /**
     * Detail pages that are reached from a list. The Topbar renders this as a
     * back link in place of the page title, so the arrow lives in the chrome
     * rather than being repeated at the top of every detail view's body.
     */
    back?: { to: string; labelKey: string };
    /**
     * i18n key for the page name. The Topbar owns the page heading, so views
     * don't repeat it as an <h1> of their own. Ignored when `back` is set.
     */
    titleKey?: string;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: LoginView, meta: { guestOnly: true } },
    { path: '/signup', component: SignupView, meta: { guestOnly: true } },
    {
      path: '/dashboard',
      component: DashboardView,
      meta: { auth: true, titleKey: 'dashboard' },
    },
    {
      path: '/users',
      component: UsersView,
      meta: { auth: true, admin: true, titleKey: 'users' },
    },
    {
      path: '/stock/categories',
      component: PartCategoriesView,
      meta: { auth: true, admin: true, titleKey: 'part_categories_title' },
    },
    {
      path: '/stock/parts',
      component: PartsView,
      meta: { auth: true, admin: true, titleKey: 'parts' },
    },
    {
      path: '/products',
      component: ProductsListView,
      meta: { auth: true, titleKey: 'products' },
    },
    {
      path: '/products/:id',
      component: ProductDetailView,
      meta: { auth: true, back: { to: '/products', labelKey: 'products' } },
    },
    // The group link (Sidebar.vue) points at the root; this redirect is what
    // makes "click the group" land on Projects, rather than a click handler.
    { path: '/projects-preparation', redirect: '/projects-preparation/projects' },
    {
      path: '/projects-preparation/projects',
      component: ProjectsView,
      meta: { auth: true, titleKey: 'projects' },
    },
    {
      path: '/projects-preparation/offers',
      component: OfferProcessingView,
      meta: { auth: true, titleKey: 'offer_processing' },
    },
    {
      path: '/settings/product-types',
      component: ProductTypesView,
      meta: { auth: true, admin: true, titleKey: 'product_types_settings_title' },
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
