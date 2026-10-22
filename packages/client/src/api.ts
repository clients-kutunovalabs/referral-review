import type { AdminApi, Api, UserApi } from "@rr/core";
import type { Http } from "./http";

const enc = encodeURIComponent;
/** `?a=1&b=x` from the values that are set, or "" when none are. */
const query = (q: Record<string, string | number | undefined>): string => {
  const parts = Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${enc(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export function createHttpApi(http: Http): Api {
  const get = <T>(path: string) => http.request<T>("GET", path);
  const post = <T = void>(path: string, body?: unknown) => http.request<T>("POST", path, body === undefined ? {} : { body });

  const user: UserApi = {
    me: () => get("/api/me"),
    listTasks: () => get("/api/tasks"),
    listClaims: () => get("/api/claims"),
    claimTask: (taskId, identityId) => post("/api/claims", { taskId, identityId }),
    retryClaimText: (claimId) => post(`/api/claims/${enc(claimId)}/retry-text`),
    async submitProof(claimId, { file, note }) {
      const fileId = await http.upload("proof", file);
      await post(`/api/claims/${enc(claimId)}/submit`, { fileId, note });
    },
    wallet: () => get("/api/wallet"),
    requestPayout: (amount, upi) => post("/api/payouts", { amountPaise: amount, upi }),
    addIdentity: (email, code) => post("/api/identities", { email, code }),
    changePassword: (current, next) => post("/api/me/password", { current, next }),
    listTickets: () => get("/api/tickets"),
    getTicket: (id) => get(`/api/tickets/${enc(id)}`),
    async createTicket({ title, body, file }) {
      const fileId = file ? await http.upload("ticket_attachment", file) : null;
      return post("/api/tickets", { title, body, ...(fileId ? { fileId } : {}) });
    },
    sendTicketMessage: (ticketId, body) => post(`/api/tickets/${enc(ticketId)}/messages`, { body })
  };

  const admin: AdminApi = {
    me: () => get("/api/admin/me"),
    dashboard: () => get("/api/admin/dashboard"),
    listTasks: (o = {}) => get(`/api/admin/tasks${query({ status: o.status, limit: o.limit })}`),
    taskCounts: () => get("/api/admin/task-counts"),
    getTask: (id) => get(`/api/admin/tasks/${enc(id)}`),
    createTask: (input) => post("/api/admin/tasks", input),
    setTaskStatus: (id, status) => post(`/api/admin/tasks/${enc(id)}/status`, { status }),
    addScripts: (id, scripts) => post(`/api/admin/tasks/${enc(id)}/scripts`, { scripts }),
    reviewQueue: (o = {}) => get(`/api/admin/review${query({ sort: o.sort, limit: o.limit })}`),
    reviewItem: (id) => get(`/api/admin/review/${enc(id)}`),
    decide: (submissionId, outcome, note) => post(`/api/admin/review/${enc(submissionId)}/decide`, { outcome, note }),
    listPayouts: (historyLimit) => get(`/api/admin/payouts${historyLimit ? `?limit=${historyLimit}` : ""}`),
    getPayout: (id) => get(`/api/admin/payouts/${enc(id)}`),
    async markPaid(id, proof) {
      const proofFileId = await http.upload("payment_proof", proof);
      await post(`/api/admin/payouts/${enc(id)}/pay`, { proofFileId });
    },
    rejectPayout: (id, reason) => post(`/api/admin/payouts/${enc(id)}/reject`, { reason }),
    listUsers: (limit) => get(`/api/admin/users${limit ? `?limit=${limit}` : ""}`),
    getUser: (userId) => get(`/api/admin/users/${enc(userId)}`),
    setUserStatus: (userId, status) => post(`/api/admin/users/${enc(userId)}/status`, { status }),
    listMembers: () => get("/api/admin/members"),
    addMember: (email) => post("/api/admin/members", { email }),
    setMemberRoles: (userId, roleIds) => post(`/api/admin/members/${enc(userId)}/roles`, { roleIds }),
    listRoles: () => get("/api/admin/roles"),
    createRole: (name) => post("/api/admin/roles", { name }),
    setRolePermissions: (roleId, permissions) => post(`/api/admin/roles/${enc(roleId)}/permissions`, { permissions }),
    deleteRole: (roleId) => http.request("DELETE", `/api/admin/roles/${enc(roleId)}`),
    listTickets: (closedLimit) => get(`/api/admin/tickets${closedLimit ? `?limit=${closedLimit}` : ""}`),
    getTicket: (id) => get(`/api/admin/tickets/${enc(id)}`),
    assignTicket: (id, assigneeUserId) => post(`/api/admin/tickets/${enc(id)}/assign`, { assigneeId: assigneeUserId }),
    replyTicket: (id, body) => post(`/api/admin/tickets/${enc(id)}/reply`, { body }),
    resolveTicket: (id) => post(`/api/admin/tickets/${enc(id)}/resolve`),
    ticketAgents: () => get("/api/admin/ticket-agents")
  };

  return { user, admin };
}
