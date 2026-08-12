import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type CollectionKey =
  | 'actors'
  | 'items'
  | 'quests'
  | 'places'
  | 'facts'
  | 'world-objects'
  | 'abilities'
  | 'relationships'
  | 'scene'
  | 'review'
  | 'context'
  | 'history';

export type RecordCollectionKey = Exclude<
  CollectionKey,
  'relationships' | 'scene' | 'review' | 'context' | 'history'
>;

export type WorkspaceRoute = Readonly<{
  campaignId: string | null;
  collection: CollectionKey;
  recordId: string | null;
  revision: number | null;
  query?: string | undefined;
}>;

const COLLECTION_KEYS: readonly CollectionKey[] = [
  'actors',
  'items',
  'quests',
  'places',
  'facts',
  'world-objects',
  'abilities',
  'relationships',
  'scene',
  'review',
  'context',
  'history',
];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isCollectionKey(value: string | undefined): value is CollectionKey {
  return value !== undefined && COLLECTION_KEYS.includes(value as CollectionKey);
}

export function parseWorkspacePath(pathname: string, search = ''): WorkspaceRoute {
  const parts = pathname.split('/').filter(Boolean).map(safeDecode);
  const campaignId = parts[0] === 'campaigns' && parts[1] ? parts[1] : null;
  const collection = isCollectionKey(parts[2]) ? parts[2] : 'actors';
  const recordId = campaignId && parts[3] ? parts[3] : null;
  const parameters = new URLSearchParams(search);
  const revisionValue = parameters.get('revision');
  const parsedRevision = revisionValue === null ? null : Number(revisionValue);
  const revision = parsedRevision !== null && Number.isInteger(parsedRevision) && parsedRevision >= 1
    ? parsedRevision
    : null;
  const query = parameters.get('q')?.trim() ?? '';
  return { campaignId, collection, recordId, revision, ...(query ? { query } : {}) };
}

export function workspaceHref(route: WorkspaceRoute): string {
  if (!route.campaignId) return '/';
  const parts = [
    'campaigns',
    encodeURIComponent(route.campaignId),
    route.collection,
    ...(route.recordId ? [encodeURIComponent(route.recordId)] : []),
  ];
  const parameters = new URLSearchParams();
  if (route.revision !== null) parameters.set('revision', String(route.revision));
  if (route.query?.trim()) parameters.set('q', route.query.trim());
  const query = parameters.toString();
  return `/${parts.join('/')}${query ? `?${query}` : ''}`;
}

export function collectionLabel(collection: CollectionKey): string {
  if (collection === 'actors') return 'Actors';
  if (collection === 'items') return 'Items';
  if (collection === 'quests') return 'Quests';
  if (collection === 'places') return 'Places';
  if (collection === 'facts') return 'Facts';
  if (collection === 'world-objects') return 'World Objects';
  if (collection === 'abilities') return 'Abilities';
  if (collection === 'relationships') return 'Relationships';
  if (collection === 'scene') return 'Current Scene';
  if (collection === 'review') return 'Review Inbox';
  if (collection === 'context') return 'Context Tray';
  return 'History';
}

function currentWorkspaceRoute(): WorkspaceRoute {
  return parseWorkspacePath(window.location.pathname, window.location.search);
}

function routeIdentity(route: WorkspaceRoute): string {
  return [route.campaignId ?? '', route.collection, route.recordId ?? '', route.revision ?? ''].join('\u0000');
}

export function requiresDirtyDraftConfirmation(
  current: WorkspaceRoute,
  next: WorkspaceRoute,
  hasDirtyDrafts: boolean,
): boolean {
  return hasDirtyDrafts && routeIdentity(current) !== routeIdentity(next);
}

type NavigationContextValue = Readonly<{
  route: WorkspaceRoute;
  navigate: (route: WorkspaceRoute, replace?: boolean) => boolean;
  reportDirtyDraft: (key: string, dirty: boolean) => void;
}>;

const NavigationContext = createContext<NavigationContextValue | null>(null);

const DEFAULT_CONFIRMATION = 'You have unsaved changes in this editor. Leave and discard them?';

export function WorkspaceNavigationProvider(props: Readonly<{
  children: ReactNode;
  confirmLeave?: (message: string) => boolean;
}>) {
  const [route, setRoute] = useState<WorkspaceRoute>(currentWorkspaceRoute);
  const routeRef = useRef(route);
  const dirtyKeysRef = useRef(new Set<string>());
  const [dirtyCount, setDirtyCount] = useState(0);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const reportDirtyDraft = useCallback((key: string, dirty: boolean) => {
    const keys = dirtyKeysRef.current;
    const changed = dirty ? !keys.has(key) : keys.has(key);
    if (!changed) return;
    if (dirty) keys.add(key);
    else keys.delete(key);
    setDirtyCount(keys.size);
  }, []);

  const confirmLeave = useCallback(() => {
    const confirm = props.confirmLeave ?? ((message: string) => window.confirm(message));
    return confirm(DEFAULT_CONFIRMATION);
  }, [props.confirmLeave]);

  const navigate = useCallback((next: WorkspaceRoute, replace = false) => {
    const current = routeRef.current;
    if (requiresDirtyDraftConfirmation(current, next, dirtyKeysRef.current.size > 0) && !confirmLeave()) {
      return false;
    }
    const href = workspaceHref(next);
    if (replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    routeRef.current = next;
    setRoute(next);
    return true;
  }, [confirmLeave]);

  useEffect(() => {
    const onPopState = () => {
      const next = currentWorkspaceRoute();
      const current = routeRef.current;
      if (requiresDirtyDraftConfirmation(current, next, dirtyKeysRef.current.size > 0) && !confirmLeave()) {
        window.history.pushState(null, '', workspaceHref(current));
        return;
      }
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [confirmLeave]);

  useEffect(() => {
    if (dirtyCount === 0) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyCount]);

  const value = useMemo<NavigationContextValue>(() => ({
    route,
    navigate,
    reportDirtyDraft,
  }), [navigate, reportDirtyDraft, route]);

  return <NavigationContext.Provider value={value}>{props.children}</NavigationContext.Provider>;
}

export function useWorkspaceNavigation(): Pick<NavigationContextValue, 'route' | 'navigate'> {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('useWorkspaceNavigation must be used inside WorkspaceNavigationProvider.');
  return value;
}

export function useWorkspaceDirtyDraft(key: string, dirty: boolean): void {
  const value = useContext(NavigationContext);
  const reportDirtyDraft = value?.reportDirtyDraft;
  useEffect(() => {
    if (!reportDirtyDraft) return undefined;
    reportDirtyDraft(key, dirty);
    return () => reportDirtyDraft(key, false);
  }, [dirty, key, reportDirtyDraft]);
}
