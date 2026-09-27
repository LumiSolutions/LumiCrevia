-- CreateTable
CREATE TABLE "ProductOrganization" (
    "id" TEXT NOT NULL,
    "orbiaOrganizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accessStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "homepagePageId" TEXT,
    "draftVersion" INTEGER NOT NULL,
    "publishedRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "navigationVisible" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "homepage" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteRevision" (
    "revisionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "SiteRevision_pkey" PRIMARY KEY ("revisionId")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tokens" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "classification" TEXT NOT NULL,
    "sourceSystem" TEXT,
    "externalAssetId" TEXT,
    "displayName" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "storageKey" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "sslStatus" TEXT NOT NULL,
    "publicationTarget" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreviewToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreviewToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "orbiaUserId" TEXT NOT NULL,
    "orbiaOrganizationId" TEXT NOT NULL,
    "creviaOrganizationId" TEXT NOT NULL,
    "membershipRole" TEXT NOT NULL,
    "modules" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ProductSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductOrganization_orbiaOrganizationId_key" ON "ProductOrganization"("orbiaOrganizationId");

-- CreateIndex
CREATE INDEX "ProductOrganization_orbiaOrganizationId_idx" ON "ProductOrganization"("orbiaOrganizationId");

-- CreateIndex
CREATE INDEX "Site_organizationId_idx" ON "Site"("organizationId");

-- CreateIndex
CREATE INDEX "Page_siteId_idx" ON "Page"("siteId");

-- CreateIndex
CREATE INDEX "Page_organizationId_idx" ON "Page"("organizationId");

-- Active slugs stay unique per site. Archived slugs may be reused.
CREATE UNIQUE INDEX "Page_siteId_slug_active_key" ON "Page"("siteId", "slug") WHERE status = 'active';

-- CreateIndex
CREATE INDEX "SiteRevision_siteId_version_idx" ON "SiteRevision"("siteId", "version");

-- CreateIndex
CREATE INDEX "SiteRevision_organizationId_idx" ON "SiteRevision"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteRevision_siteId_version_key" ON "SiteRevision"("siteId", "version");

-- CreateIndex
CREATE INDEX "Publication_siteId_idx" ON "Publication"("siteId");

-- CreateIndex
CREATE INDEX "Publication_organizationId_idx" ON "Publication"("organizationId");

-- CreateIndex
CREATE INDEX "Theme_siteId_idx" ON "Theme"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Theme_organizationId_siteId_key" ON "Theme"("organizationId", "siteId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE INDEX "Asset_siteId_idx" ON "Asset"("siteId");

-- CreateIndex
CREATE INDEX "Domain_siteId_idx" ON "Domain"("siteId");

-- CreateIndex
CREATE INDEX "Domain_organizationId_idx" ON "Domain"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PreviewToken_tokenHash_key" ON "PreviewToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PreviewToken_tokenHash_idx" ON "PreviewToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSession_tokenHash_key" ON "ProductSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ProductSession_tokenHash_idx" ON "ProductSession"("tokenHash");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteRevision" ADD CONSTRAINT "SiteRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteRevision" ADD CONSTRAINT "SiteRevision_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviewToken" ADD CONSTRAINT "PreviewToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviewToken" ADD CONSTRAINT "PreviewToken_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSession" ADD CONSTRAINT "ProductSession_creviaOrganizationId_fkey" FOREIGN KEY ("creviaOrganizationId") REFERENCES "ProductOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
