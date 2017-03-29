import { TaskQueue } from 'aurelia-task-queue';
import { BindingEngine } from 'aurelia-binding';
import { EventAggregator } from 'aurelia-event-aggregator';
import { Configure } from './configure';
import { GoogleMapsAPI } from './google-maps-api';
export interface BaseMarker {
    icon?: string;
    label?: string;
    title?: string;
    draggable?: boolean;
    custom?: any;
    infoWindow?: {
        pixelOffset?: number;
        content: string;
        position?: number;
        maxWidth?: number;
    };
}
export interface AddressMarker extends BaseMarker {
    address: string;
}
export interface LatLongMarker extends BaseMarker {
    latitude: number | string;
    longitude: number | string;
}
export declare type Marker = AddressMarker | LatLongMarker;
export declare class GoogleMaps {
    private element;
    private taskQueue;
    private config;
    private bindingEngine;
    private eventAggregator;
    private googleMapsApi;
    private validMarkers;
    private _geocoder;
    address: any;
    longitude: number;
    latitude: number;
    zoom: number;
    disableDefaultUI: boolean;
    markers: any;
    autoUpdateBounds: boolean;
    mapType: string;
    options: {};
    mapLoaded: any;
    drawEnabled: boolean;
    drawMode: string;
    drawOverlayCompleteEvent: any;
    polygons: any;
    map: any;
    _renderedMarkers: any;
    _markersSubscription: any;
    _scriptPromise: Promise<any> | any;
    _mapPromise: Promise<any> | any;
    _mapResolve: Promise<any> | any;
    _locationByAddressMarkers: any;
    drawingManager: any;
    _renderedPolygons: any;
    _polygonsSubscription: any;
    constructor(element: Element, taskQueue: TaskQueue, config: Configure, bindingEngine: BindingEngine, eventAggregator: EventAggregator, googleMapsApi: GoogleMapsAPI);
    clearMarkers(): void;
    attached(): void;
    sendBoundsEvent(): void;
    sendApiLoadedEvent(): void;
    renderMarker(marker: LatLongMarker): Promise<void>;
    geocodeAddress(address: string): void;
    addressMarkerToMarker(marker: AddressMarker): Promise<LatLongMarker>;
    private geocode(address);
    private readonly geocoder;
    getCurrentPosition(): any;
    setOptions(options: any): void;
    createMarker(options: any): any;
    getCenter(): void;
    setCenter(latLong: any): void;
    updateCenter(): void;
    addressChanged(newValue: any): void;
    latitudeChanged(): void;
    longitudeChanged(): void;
    zoomChanged(newValue: any): void;
    markersChanged(newValue: Marker[]): void;
    markerCollectionChange(splices: any): void;
    zoomToMarkerBounds(force?: boolean): void;
    getMapTypeId(): any;
    error(): void;
    resize(): void;
    initDrawingManager(options?: any): any;
    destroyDrawingManager(): void;
    getOverlayType(type?: any): any;
    drawEnabledChanged(newval: any, oldval: any): void;
    drawModeChanged(newval?: any): void;
    encodePath(path?: any): any;
    decodePath(polyline: string): any;
    renderPolygon(paths?: any): void;
    polygonsChanged(newValue: any): void;
    polygonCollectionChange(splices: any): void;
}
