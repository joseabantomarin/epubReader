// Single source of truth for "can this user see/open this book?".
// `book` is a full row from the books table; `userId` may be null (anonymous).
export function canAccessBook(db, book, userId) {
  if (!book) return false;
  if (userId != null && book.user_id === userId) return true; // owner
  switch (book.visibility) {
    case 'public':
      return !book.censored;
    case 'group': {
      if (userId == null || !book.share_group_id) return false;
      const row = db.prepare(
        'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1'
      ).get(book.share_group_id, userId);
      return !!row;
    }
    case 'user':
      return userId != null && book.share_user_id === userId;
    default: // 'private'
      return false;
  }
}
