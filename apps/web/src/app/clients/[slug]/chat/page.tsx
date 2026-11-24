import { redirect } from 'next/navigation';

/**
 * The old per-client chat. Tanya Tempo is now one general chat over every
 * client (`/chat`), so this path only forwards there for existing links.
 */
export default function ClientChatRedirect() {
  redirect('/chat');
}
