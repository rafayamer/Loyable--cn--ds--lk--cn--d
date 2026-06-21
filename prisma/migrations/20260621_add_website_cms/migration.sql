-- CreateTable: website_settings
CREATE TABLE IF NOT EXISTS "website_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "website_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable: website_sections
CREATE TABLE IF NOT EXISTS "website_sections" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "website_sections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "website_sections_slug_key" ON "website_sections"("slug");

-- CreateTable: feature_cards
CREATE TABLE IF NOT EXISTS "feature_cards" (
    "id" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pricing_plans
CREATE TABLE IF NOT EXISTS "pricing_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "monthlyPrice" INTEGER NOT NULL DEFAULT 0,
    "yearlyPrice" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "features" JSONB NOT NULL,
    "ctaText" TEXT NOT NULL DEFAULT 'Get Started',
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cms_testimonials
CREATE TABLE IF NOT EXISTS "cms_testimonials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "text" TEXT NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 5,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cms_testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable: partner_businesses
CREATE TABLE IF NOT EXISTS "partner_businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "location" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "showOnHome" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: public_reviews
CREATE TABLE IF NOT EXISTS "public_reviews" (
    "id" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT,
    "avatarUrl" TEXT,
    "bizType" TEXT,
    "stars" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "public_reviews_status_idx" ON "public_reviews"("status");
CREATE INDEX IF NOT EXISTS "public_reviews_createdAt_idx" ON "public_reviews"("createdAt");

-- CreateTable: blog_posts
CREATE TABLE IF NOT EXISTS "blog_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "coverImage" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "seoTitle" TEXT,
    "seoDesc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateTable: faq_items
CREATE TABLE IF NOT EXISTS "faq_items" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: announcement_banners
CREATE TABLE IF NOT EXISTS "announcement_banners" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "linkText" TEXT,
    "linkUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcement_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable: website_page_views
CREATE TABLE IF NOT EXISTS "website_page_views" (
    "id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "event" TEXT NOT NULL DEFAULT 'PAGE_VIEW',
    "referer" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "website_page_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "website_page_views_page_createdAt_idx" ON "website_page_views"("page", "createdAt");
