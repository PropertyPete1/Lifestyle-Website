/** Builder checks run from 4 AM (fresh each morning) until 10 PM Central: the catalog cron is a no-op outside these hours. */
export const CATALOG_FIRST_HOUR = 4;
export const CATALOG_LAST_HOUR = 22;
