/**
 * Every name this package shows the world, in one place: a rename is one commit. Copied rather than
 * imported, because this package imports nothing from the tree (see CLAUDE.md).
 */

export const BRAND = {
    name: "Dispach",
    /** Every environment variable this process reads. */
    envPrefix: "DISPACH_GUEST_",
    /** Guest tokens carry a prefix so one found in a log is recognisable for what it is. */
    tokenPrefix: "dguest_",
} as const
