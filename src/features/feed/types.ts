export interface FeedAuthor {
  id: string;
  username: string;
}

export interface FeedCommunity {
  id: string;
  name: string;
  slug: string;
}

export interface FeedPost {
  id: string;
  communityId: string;
  authorId: string;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: FeedAuthor;
  community: FeedCommunity;
}

export interface FeedResult {
  posts: FeedPost[];
  nextCursor?: string;
  hasNoMemberships?: boolean;
}
