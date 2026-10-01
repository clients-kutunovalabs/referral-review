import "./styles/index.css";
export * from "./primitives";
export * from "./tokens/tokens";
export { UserApp, type UserScreen, type MyTab, type UserAppProps } from "./screens/user/UserApp";
export { AdminApp, type AdminScreen, type AdminAppProps } from "./screens/admin/AdminApp";
export { resetTickets } from "./demo/ticketStore";
