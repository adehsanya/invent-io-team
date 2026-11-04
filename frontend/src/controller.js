import { createViews } from "./views.jsx";
import { rememberEmail } from "./authScreens.jsx";
import { createApi } from "../public/api.js";
import { createPush } from "../public/notifications.js";
import { prepareImport, MAX_CSV_BYTES } from "../public/csv-import.js";
import { stockByProduct, restockBody, correctionBody, voidBody, wholeNumber } from "./stockAdapter.js";
import { formatMinor, nairaToMinor, safeMinorNumber } from "../public/money.js";

export function createMerchantController({ ui, rerender }) {
  const {
    esc,
    btn,
    link,
    field,
    notice,
    empty,
    ico,
    brand,
    go,
    toast,
    modal,
    closeModal,
  } = ui;
  const $ = (s, r = document) => r.querySelector(s);
  const state = {
    search: "",
    stock: {},
    productFilter: "all",
    formNonce: 0,
    salesTab: "pending",
    salesSort: "oldest",
    salesRange: "today",
    payments: [],
    sales: [],
    summary: null,
    coreErrors: [],
    coreLoading: false,
    quantities: {},
    recordBranch: "",
    paymentId: null,
    saleKey: null,
    allocating: false,
    tenant: null,
    products: [],
    managed: null,
    loading: false,
    error: "",
    catalogError: "",
    accountError: "",
    csv: null,
    csvText: "",
    fileName: "",
    units: "naira",
    result: null,
    importing: false,
    profile: null,
    pushReady: false,
    pushMessage: "",
    prompting: false,
    enabled: false,
    initialized: false,
    submitting: false,
  };
  let generation = 0, lastRoute = "";
  const api = createApi({
    onExpired: () => {
      generation++;
      clearData();
      push.disable().catch(() => {});
      go("login", true);
      toast("Session expired. Please log in again.");
    },
  });
  const push = createPush({ api });
  const can = (p) =>
    state.tenant?.permissions?.includes("*") ||
    state.tenant?.permissions?.includes(p);
  const person = () =>
    state.profile || {
      name: api.session?.name || "Your account",
      email: api.session?.email || "",
    };
  const message = (error) =>
    error.message + (error.requestId ? " · Reference: " + error.requestId : "");
  const notifyError = (error) => toast(message(error));
  function clearData() {
    Object.assign(state, {
      tenant: null,
      products: [],
      managed: null,
      payments: [],
      sales: [],
      summary: null,
      quantities: {},
      paymentId: null,
      saleKey: null,
      initialized: false,
      loading: false,
      coreLoading: false,
      catalogError: "",
      accountError: "",
      error: "",
      csv: null,
      csvText: "",
      result: null,
      pushReady: false,
      enabled: false,
      prompting: false,
    });
  }
  const {shell, auth, checkEmail, verifyPending, home, products, importScreen, editor, onboarding, managedForm,
    direct, changePassword, verifyEmailScreen, account, notificationSettings, moreScreen, productView, stockDialog, voidDialog, admin, salesScreen, saleDetail,
    recordPayment, matchScreen} = createViews({state, api, push, can, person, ui,
      selectedItems, route: () => lastRoute, verify: async token => {
        await api.request("/auth/verify-email", {method:"POST",body:{token},auth:false});
      }});
  async function loadStock() {
    const branchId = state.tenant?.branchId;
    if (!branchId || !can("stock.read")) return;
    try {
      state.stock = stockByProduct(
        await api.request("/branches/" + encodeURIComponent(branchId) + "/stock"),
      );
    } catch {
      state.stock = {};
    }
  }
  async function initialize() {
    if (!api.session || state.loading) return;
    const turn = ++generation;
    state.loading = true;
    state.error = "";
    rerender();
    try {
      const tenant = await api.request("/tenancy/me");
      if (turn !== generation) return;
      if (!Array.isArray(tenant?.permissions))
        throw new Error("The backend did not return your access permissions.");
      state.tenant = tenant;
      if (tenant.profile) state.profile = tenant.profile;
      state.initialized = true;
      await Promise.all([loadProducts(), loadManaged(), loadCore(), loadStock()]);
      if (turn !== generation) return;
      prepareNotifications();
    } catch (error) {
      if (turn === generation) state.error = message(error);
    } finally {
      if (turn === generation) {
        state.loading = false;
        rerender();
      }
    }
  }
  async function loadProducts() {
    if (!can("catalog.read")) return;
    state.catalogError = "";
    const turn = generation;
    try {
      const rows = await api.pages("/products");
      if (turn === generation) state.products = rows;
    } catch (error) {
      if (turn === generation) state.catalogError = message(error);
    }
  }
  async function loadManaged() {
    if (!can("payments.manage")) return;
    state.accountError = "";
    const turn = generation;
    try {
      const account = await api.request("/payments/managed-account");
      if (turn === generation) state.managed = account;
    } catch (error) {
      if (turn === generation) state.accountError = message(error);
    }
  }
  async function prepareNotifications() {
    const turn = generation;
    const support = push.support();
    if (!support.supported) {
      state.pushMessage = support.message;
      if (["home", "account", "notification-settings"].includes(lastRoute)) rerender();
      return;
    }
    try {
      const ready = await push.prepare();
      if (turn !== generation) return;
      state.enabled = ready.subscribed;
      state.pushReady = true;
      state.pushMessage = "";
      if (["home", "account", "notification-settings"].includes(lastRoute)) rerender();
      if (
        lastRoute === "home" &&
        Notification.permission === "default" &&
        !sessionStorage.getItem("invent-push-later-" + api.session?.userId) &&
        !state.prompting
      ) {
        state.prompting = true;
        modal(
          "Allow notifications?",
          notice("Get payment and low-stock alerts. You can change this in Account at any time."),
          [btn("Not now", "unused", "secondary", 'data-live="push-later"'),
            btn(
              "Allow notifications",
              "unused",
              "primary",
              'data-live="push-enable"',
            )],
        );
      }
    } catch (error) {
      if (turn !== generation) return;
      state.pushReady = false;
      state.pushMessage = message(error);
      if (["home", "account", "notification-settings"].includes(lastRoute)) rerender();
    }
  }
  function enter(route) {
    const previousRoute = lastRoute;
    lastRoute = route;
    if (!api.session || ["welcome","login","create","forgot","reset","check","verify-email","verify-pending"].includes(route)) return;
    if (!state.initialized && !state.loading && !state.error) { void initialize(); return; }
    if (previousRoute !== route && state.initialized && ["home","sales","sale-detail"].includes(route)) {
      void loadCore().then(rerender);
    }
  }
  function render(route, params) {
    if (route === "welcome") return null;
    if (["login", "create", "forgot", "reset"].includes(route))
      return auth(route);
    if (route === "check") return checkEmail();
    if (route === "verify-pending") return api.session ? verifyPending() : auth("login");
    if (route === "verify-email") return verifyEmailScreen(params);
    if (!api.session) return auth("login");
    if (state.loading)
      return shell(
        "Loading",
        notice("Loading your workspace…"),
      );
    if (state.error)
      return shell(
        "Workspace unavailable",
        [notice(state.error, "warning"), btn("Try again", "unused", "primary", 'data-live="retry"'), btn("Log out", "unused", "secondary", 'data-live="logout"')],
      );
    if (!state.initialized)
      return shell("Loading", "Loading your workspace…");
    const screens = {
      home,
      "record-payment": recordPayment,
      "sale-detail": () => saleDetail(params.get("id")),
      sales: salesScreen,
      "match-payment": matchScreen,
      products,
      import: importScreen,
      onboarding,
      "onboarding-managed": managedForm,
      "onboarding-direct": direct,
      account,
      "change-password": changePassword,
      "verify-email": verifyEmailScreen,
      settings: account,
      more: moreScreen,
      "notification-settings": notificationSettings,
      "product-view": () => productView(params.get("id")),
      "product-new": () => editor(),
      "product-edit": () => editor(params.get("id")),
      product: () => editor(params.get("id")),
      admin,
      "catalog-new": () => editor(),
      "catalog-edit": () => editor(params.get("id")),
    };
    return screens[route]
      ? screens[route]()
      : shell(
          "Feature unavailable",
          empty(
            "This flow is not connected yet",
            "Use your catalog, payment setup or Account. Contact your administrator if you need access.",
            link("Go home", "home", "primary"),
          ),
        );
  }

  async function loadCore() {
    if (state.coreLoading) return;
    const turn = generation;
    state.coreLoading = true;
    const errors = [];
    const jobs = [];
    if (can("sales.allocate"))
      jobs.push(
        api
          .pages("/payments?status=SUCCEEDED")
          .then((rows) => {
            if (turn === generation) state.payments = rows;
          })
          .catch((error) => errors.push("Pending payments: " + message(error))),
      );
    if (can("reports.view")) {
      jobs.push(
        api
          .request("/dashboard/summary")
          .then((data) => {
            if (turn === generation) state.summary = data;
          })
          .catch((error) => errors.push("Sales summary: " + message(error))),
      );
      jobs.push(
        api
          .pages("/reports/sales")
          .then((rows) => {
            if (turn === generation) state.sales = rows;
          })
          .catch((error) => errors.push("Recorded sales: " + message(error))),
      );
    }
    await Promise.all(jobs);
    if (turn === generation) {
      state.coreErrors = errors;
      state.coreLoading = false;
    }
  }
  function selectedItems() {
    return Object.entries(state.quantities)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({
        product: state.products.find((p) => p.id === id),
        qty,
      }))
      .filter((x) => x.product);
  }
  async function allocate() {
    if (state.allocating || !can("sales.allocate")) return;
    const items = selectedItems();
    if (!items.length) return;
    state.saleKey ||= crypto.randomUUID();
    state.allocating = true;
    rerender();
    try {
      const sale = await api.request(
        "/payments/" + encodeURIComponent(state.paymentId) + "/match",
        {
          method: "POST",
          body: {
            items: items.map((i) => ({ productId: i.product.id, qty: i.qty })),
            idempotencyKey: state.saleKey,
          },
        },
      );
      await loadCore();
      state.quantities = {};
      state.saleKey = null;
      go("sales", true);
      toast("Sale recorded · " + formatMinor(sale.total));
    } catch (error) {
      if (error.status === 409) {
        await loadCore();
        go("sales", true);
        toast(
          "This payment was already matched. The queue has been refreshed.",
        );
      } else {
        rerender();
        const node = $("#allocate-error");
        if (node)
          node.textContent =
            message(error) + " Retry uses the same request key.";
      }
    } finally {
      state.allocating = false;
      const button = $("[data-live=allocate]");
      if (button) {
        button.disabled = false;
        button.textContent = "Confirm sale";
      }
    }
  }

  function valid(form) {
    let ok = true;
    form.querySelectorAll("[data-error]").forEach((x) => (x.textContent = ""));
    for (const input of form.querySelectorAll("input,select")) {
      if (!input.checkValidity()) {
        const target = form.querySelector(`[data-error="${input.name}"]`);
        if (target)
          target.textContent = input.validity.valueMissing
            ? "This field is required."
            : input.validationMessage;
        ok = false;
      }
    }
    if (!ok) form.querySelector(":invalid")?.focus();
    return ok;
  }
  function setError(form, error) {
    const target = $("#live-error", form) || $("#import-error");
    if (target) target.textContent = form.dataset?.kind === "login" && error?.status === 401 ? "Email or password is incorrect. Check them and try again." : message(error);
    else notifyError(error);
  }
  async function busy(form, work) {
    if (state.submitting) return;
    state.submitting = true;
    form
      .querySelectorAll("button[type=submit]")
      .forEach((x) => (x.disabled = true));
    try {
      await work();
    } catch (error) {
      setError(form, error);
    } finally {
      state.submitting = false;
      if (form.isConnected)
        form
          .querySelectorAll("button[type=submit]")
          .forEach((x) => (x.disabled = false));
    }
  }
  async function importFile(file) {
    state.csv = null;
    state.result = null;
    state.csvText = "";
    if (!file) return;
    if (file.size > MAX_CSV_BYTES)
      throw new Error("Choose a CSV smaller than 2 MB.");
    if (!/\.csv$/i.test(file.name))
      throw new Error("Export your spreadsheet as a .csv file first.");
    state.csvText = await file.text();
    state.fileName = file.name;
    state.csv = prepareImport(state.csvText, state.units);
    rerender();
  }
  const onChange = async (event) => {
    const el = event.target;
    try {
      if (el.id === "live-csv") await importFile(el.files?.[0]);
      if (el.id === "live-units") {
        state.units = el.value;
        state.result = null;
        state.csv = null;
        if (state.csvText)
          state.csv = prepareImport(state.csvText, state.units);
        rerender();
      }
    } catch (error) {
      const target = $("#import-error");
      if (target) target.textContent = error.message;
    }
  };
  const onInput = (event) => {
    if (event.target.id === "live-search") {
      state.search = event.target.value;
      rerender();
    }
  };
  const onClick = async (event) => {
    const scroll = event.target.closest("[data-scroll]");
    if (scroll) {
      event.preventDefault();
      document
        .getElementById(scroll.dataset.scroll)
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (event.target.closest("[data-action=close]")) {
      closeModal();
      return;
    }
    const b = event.target.closest("[data-live]");
    if (!b || b.disabled) return;
    const action = b.dataset.live;
    try {
      if (action === "refresh-core") {
        await loadCore();
        rerender();
        return;
      }
      if (action === "set-ui") {
        state[b.dataset.key] = b.dataset.value;
        rerender();
        return;
      }
      if (action === "stock-open") {
        modal(...stockDialog(b.dataset.mode, b.dataset.id));
        return;
      }
      if (action === "void-open") {
        modal(...voidDialog(b.dataset.id));
        return;
      }
      if (action === "void-confirm") {
        if (!can("sales.refund"))
          throw new Error("You don’t have permission to void sales.");
        b.disabled = true;
        await api.request("/sales/" + encodeURIComponent(b.dataset.id) + "/refund", {
          method: "POST",
          body: voidBody(),
        });
        closeModal();
        await Promise.all([loadCore(), loadStock()]);
        toast("Sale voided. The payment is back in Pending payments.");
        return go("sales");
      }
      if (action === "begin-match") {
        state.paymentId = b.dataset.id;
        state.quantities = {};
        state.saleKey = null;
        return go("match-payment");
      }
      if (action === "live-quantity") {
        if (state.allocating) return;
        state.quantities[b.dataset.id] = Math.max(
          0,
          Math.min(
            999,
            (state.quantities[b.dataset.id] || 0) + Number(b.dataset.delta),
          ),
        );
        state.saleKey = null;
        rerender();
        return;
      }
      if (action === "allocate") return allocate();
      if (action === "go") return go(b.dataset.to);
      if (action === "retry") return initialize();
      if (action === "push-later") {
        sessionStorage.setItem("invent-push-later-" + api.session?.userId, "1");
        closeModal();
        return;
      }
      if (action === "push-prepare") {
        b.disabled = true;
        await prepareNotifications();
        return;
      }
      if (action === "push-enable") {
        b.disabled = true;
        try {
          await push.enable();
          state.enabled = true;
          sessionStorage.setItem(
            "invent-push-later-" + api.session.userId,
            "1",
          );
          closeModal();
          toast("Notifications enabled");
        } finally {
          b.disabled = false;
          rerender();
        }
        return;
      }
      if (action === "push-disable") {
        b.disabled = true;
        try {
          await push.disable();
          state.enabled = false;
          toast("Notifications turned off");
        } finally {
          b.disabled = false;
          rerender();
        }
        return;
      }
      if (action === "logout") {
        b.disabled = true;
        generation++;
        try {
          await push.disable().catch(() => {});
          await api.logout();
        } finally {
          api.clear();
          state.loading = false;
          state.coreLoading = false;
          state.tenant = null;
          state.profile = null;
          state.products = [];
          state.payments = [];
          state.sales = [];
          state.summary = null;
          state.managed = null;
          state.initialized = false;
          state.enabled = false;
          closeModal();
          go("login", true);
        }
        return;
      }
      if (action === "refresh-products") {
        b.disabled = true;
        await loadProducts();
        rerender();
        return;
      }
      if (action === "refresh-account") {
        b.disabled = true;
        await loadManaged();
        rerender();
        return;
      }
      if (action === "import-submit") {
        if (!can("catalog.write") || !state.csv || state.importing) return;
        const csv = state.csv.csv;
        state.importing = true;
        state.result = null;
        rerender();
        try {
          const result = await api.request("/products/import", {
            method: "POST",
            body: { csv },
          });
          if (
            !Number.isInteger(result?.created) ||
            !Number.isInteger(result.updated) ||
            !Number.isInteger(result.skipped) ||
            !Array.isArray(result.errors)
          )
            throw new Error(
              "The server returned an unexpected import result. Check the catalog before retrying.",
            );
          state.result = result;
          state.csv = null;
          state.csvText = "";
          await loadProducts();
        } catch (error) {
          state.csv = null;
          state.csvText = "";
          state.result = null;
          state.importError =
            message(error) +
            " Check the catalog before choosing the file again; the server may have processed some rows.";
        } finally {
          state.importing = false;
          rerender();
          if (state.importError) {
            $("#import-error").textContent = state.importError;
            state.importError = "";
          }
        }
        return;
      }
    } catch (error) {
      notifyError(error);
      if (b.isConnected) b.disabled = false;
    }
  };
  const onSubmit = async (event) => {
    const form = event.target;
    if (!form.id.startsWith("live-")) return;
    event.preventDefault();
    if (!valid(form)) return;
    const data = Object.fromEntries(new FormData(form));
    await busy(form, async () => {
      if (form.id === "live-auth") {
        const kind = form.dataset.kind;
        if (kind === "forgot") {
          await api.request("/auth/forgot-password", {
            method: "POST",
            body: { email: data.email },
            auth: false,
          });
          rememberEmail("reset", data.email.trim());
          form.reset();
          go("check", true);
          return;
        }
        if (kind === "reset") {
          const token = new URLSearchParams(location.hash.split("?")[1]).get(
            "token",
          );
          if (!token)
            throw new Error(
              "This reset link is missing its token. Request a new reset link.",
            );
          if (data.password !== data.confirm)
            throw new Error("Passwords don’t match.");
          await api.request("/auth/reset-password", {
            method: "POST",
            body: { token, password: data.password },
            auth: false,
          });
          form.reset();
          go("login", true);
          toast("Password updated. Log in with your new password.");
          return;
        }
        await push.disable().catch(() => {});
        const payload =
          kind === "create"
            ? {
                name: data.name.trim(),
                businessName: data.businessName.trim(),
                email: data.email.trim(),
                password: data.password,
              }
            : { email: data.email.trim(), password: data.password };
        await api.authenticate(
          kind === "create" ? "register" : "login",
          payload,
        );
        generation++;
        clearData();
        state.profile = {
          name: data.name?.trim() || "Your account",
          email: data.email.trim(),
        };
        form.reset();
        state.initialized = false;
        state.tenant = null;
        state.error = "";
        state.pushReady = false;
        state.prompting = false;
        state.loading = false;
        state.coreLoading = false;
        if (kind === "create") rememberEmail("verify", data.email.trim());
        go(kind === "create" ? "verify-pending" : "home", true);
        if (kind !== "create") await initialize();
        return;
      }
      if (form.id === "live-cash-payment") {
        if (!can("sales.allocate")) throw new Error("You don’t have permission to record payments.");
        const amountMinor = nairaToMinor(data.amount);
        if (BigInt(amountMinor) <= 0n) throw new Error("Enter an amount greater than zero.");
        const branchId = state.tenant?.branchId || data.branchId;
        if (!branchId) throw new Error("Choose a branch first.");
        const payment = await api.request("/payments/manual", {method:"POST", body:{amountMinor, branchId}});
        await loadCore(); state.paymentId=payment.id; state.quantities={}; state.saleKey=null;
        form.reset(); go("match-payment",true); return;
      }
      if (form.id === "live-change-password") {
        if (data.newPassword !== data.confirm) throw new Error("Passwords don’t match.");
        await api.request("/auth/change-password", {
          method: "POST", retry: false,
          body: { currentPassword: data.currentPassword, newPassword: data.newPassword },
        });
        form.reset();
        await push.disable().catch(() => {});
        api.clear(); generation++; clearData(); state.profile = null;
        go("login", true); toast("Password updated. Log in with your new password.");
        return;
      }
      if (form.id === "live-stock") {
        if (!can("stock.adjust"))
          throw new Error("You don’t have permission to change stock.");
        const productId = form.dataset.id;
        const branchId = state.tenant?.branchId;
        const qty = wholeNumber(data.qty);
        const errorLine = document.getElementById("stock-error");
        if (qty == null || (form.dataset.mode === "add" && qty < 1)) {
          if (errorLine) errorLine.textContent = "Enter a whole number" + (form.dataset.mode === "add" ? " above 0." : ".");
          return;
        }
        if (!branchId) throw new Error("Your branch could not be found. Log in again.");
        const current = state.stock[productId]?.qty;
        if (form.dataset.mode === "correct" && current == null)
          throw new Error("Current stock isn’t available yet.");
        await api.request("/stock/adjustments", {
          method: "POST",
          body:
            form.dataset.mode === "add"
              ? restockBody({ branchId, productId, qty })
              : correctionBody({ branchId, productId, current, target: qty }),
        });
        closeModal();
        await loadStock();
        rerender();
        toast(form.dataset.mode === "add" ? "Stock added" : "Count saved");
        return;
      }
      if (form.id === "live-product") {
        if (!can("catalog.write"))
          throw new Error("You don’t have permission to edit the catalog.");
        const payload = {
          name: data.name.trim(),
          price: safeMinorNumber(nairaToMinor(data.price)),
          cost: safeMinorNumber(nairaToMinor(data.cost)),
          ...(data.sku ? { sku: data.sku.trim() } : {}),
        };
        await api.request(
          "/products" +
            (form.dataset.id ? "/" + encodeURIComponent(form.dataset.id) : ""),
          { method: form.dataset.id ? "PATCH" : "POST", body: payload },
        );
        await loadProducts();
        if (event.submitter?.dataset?.again && !form.dataset.id) {
          state.formNonce++;
          rerender();
          toast("Product saved. Add the next one.");
          return;
        }
        go("products", true);
        toast("Product saved");
        return;
      }
      if (form.id === "live-managed") {
        if (!can("payments.manage"))
          throw new Error(
            "You don’t have permission to set up payment accounts.",
          );
        if (data.ownerConsent !== "on")
          throw new Error(
            "Confirm that you’re authorized to submit these details.",
          );
        const payload = {
          businessName: data.businessName.trim(),
          ownerName: data.ownerName.trim(),
          ownerEmail: data.ownerEmail.trim(),
          customerFirstName: data.customerFirstName.trim(),
          customerLastName: data.customerLastName.trim(),
          settlementBankCode: data.settlementBankCode.trim(),
          settlementAccountNumber: data.settlementAccountNumber.trim(),
          ownerConsent: true,
          ...(data.ownerPhone ? { ownerPhone: data.ownerPhone.trim() } : {}),
        };
        state.managed = await api.request("/payments/managed-account", {
          method: "POST",
          body: payload,
        });
        form.reset();
        await loadManaged();
        go("onboarding", true);
        toast("Payment account setup submitted. Review its status below.");
        return;
      }
    });
  };
  return { render, enter, api, onChange, onInput, onClick, onSubmit };
}
