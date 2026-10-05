import { handlers } from "@/serveur/auth";

// Points d'entrée d'Auth.js (session, déconnexion, protection CSRF) : /api/auth/*
export const { GET, POST } = handlers;
