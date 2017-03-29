import { inject } from 'aurelia-dependency-injection';
import { bindable, customElement, noView } from 'aurelia-templating';
import { TaskQueue } from 'aurelia-task-queue';
import { BindingEngine } from 'aurelia-binding';
import { EventAggregator } from 'aurelia-event-aggregator';
import { getLogger } from 'aurelia-logging';

import { Configure } from './configure';
import { GoogleMapsAPI } from './google-maps-api';

const GM = 'googlemap';
const BOUNDSCHANGED = `${GM}:bounds_changed`;
const CLICK = `${GM}:click`;
const INFOWINDOWDOMREADY = `${GM}:infowindow:domready`;
const MARKERCLICK = `${GM}:marker:click`;
const MARKERMOUSEOVER = `${GM}:marker:mouse_over`;
const MARKERMOUSEOUT = `${GM}:marker:mouse_out`;
const APILOADED = `${GM}:api:loaded`;
const LOCATIONADDED = `${GM}:marker:added`;
const OVERLAYCOMPLETE = `${GM}:draw:overlaycomplete`;
const logger = getLogger('aurelia-google-maps');

declare let google: any;

export interface BaseMarker {
    icon?: string;
    label?: string;
    title?: string;
    draggable?: boolean;
    custom?: any;
    infoWindow?: { pixelOffset?: number, content: string, position?: number, maxWidth?: number }
}

export interface AddressMarker extends BaseMarker {
    address: string;
}

export interface LatLongMarker extends BaseMarker {
    latitude: number | string;
    longitude: number | string;
}

const isAddressMarker = (marker: Marker): marker is AddressMarker => {
    return (<AddressMarker>marker).address !== undefined;
}

const isLatLongMarker = (marker: Marker): marker is LatLongMarker => {
    return (<LatLongMarker>marker).latitude !== undefined && (<LatLongMarker>marker).longitude !== undefined;
}

export type Marker = AddressMarker | LatLongMarker;

@noView()
@customElement('google-map')
@inject(Element, TaskQueue, Configure, BindingEngine, EventAggregator, GoogleMapsAPI)
export class GoogleMaps {
    private element: Element;
    private taskQueue: TaskQueue;
    private config: any;
    private bindingEngine: BindingEngine;
    private eventAggregator: EventAggregator;
    private googleMapsApi: GoogleMapsAPI;
    private validMarkers: LatLongMarker[];
    private _geocoder: any;

    @bindable address = null;
    @bindable longitude: number = 0;
    @bindable latitude: number = 0;
    @bindable zoom: number = 8;
    @bindable disableDefaultUI: boolean = false;
    @bindable markers: any = [];
    @bindable autoUpdateBounds: boolean = false;
    @bindable mapType = 'ROADMAP';
    @bindable options = {};
    @bindable mapLoaded: any;
    @bindable drawEnabled: boolean = false;
    @bindable drawMode = 'MARKER';
    @bindable drawOverlayCompleteEvent = null;
    @bindable polygons: any = [];

    public map: any = null;
    public _renderedMarkers: any = [];
    public _markersSubscription: any = null;
    public _scriptPromise: Promise<any> | any = null;
    public _mapPromise: Promise<any> | any = null;
    public _mapResolve: Promise<any> | any = null;
    public _locationByAddressMarkers: any = [];
    public drawingManager: any = null;
    public _renderedPolygons: any = [];
    public _polygonsSubscription: any = null;

    constructor(element: Element, taskQueue: TaskQueue, config: Configure, bindingEngine: BindingEngine, eventAggregator: EventAggregator, googleMapsApi: GoogleMapsAPI) {
        this.element = element;
        this.taskQueue = taskQueue;
        this.config = config;
        this.bindingEngine = bindingEngine;
        this.eventAggregator = eventAggregator;
        this.googleMapsApi = googleMapsApi;

        if (!config.get('apiScript')) {
            logger.error('No API script is defined.');
        }

        if (!config.get('apiKey') && config.get('apiKey') !== false) {
            logger.error('No API key has been specified.');
        }
        
        this._scriptPromise = this.googleMapsApi.getMapsInstance();

        let self: GoogleMaps = this;
        this._mapPromise = this._scriptPromise.then(() => {
            return new Promise((resolve) => {
                // Register the the resolve method for _mapPromise
                self._mapResolve = resolve;
            });
        });

        this.eventAggregator.subscribe('startMarkerHighlight', function(data: any) {
            let mrkr: any = self._renderedMarkers[data.index];
            mrkr.setIcon(mrkr.custom.altIcon);
            mrkr.setZIndex((<any>window).google.maps.Marker.MAX_ZINDEX + 1);
        });

        this.eventAggregator.subscribe('stopMarkerHighLight', function(data: any) {
            let mrkr: any = self._renderedMarkers[data.index];
            mrkr.setIcon( mrkr.custom.defaultIcon);
        });

        this.eventAggregator.subscribe('panToMarker', function(data: any) {
            self.map.panTo(self._renderedMarkers[data.index].position);
            self.map.setZoom(17);
        });

        this.eventAggregator.subscribe(`clearMarkers`, function() {
            this.clearMarkers();
        });
    }

    clearMarkers() {
        if (!this._locationByAddressMarkers || !this._renderedMarkers) {
            return;
        }

        this._locationByAddressMarkers.concat(this._renderedMarkers).forEach(function(marker: any) {
            marker.setMap(null);
        });

        this._locationByAddressMarkers = [];
        this._renderedMarkers = [];
    }

    attached() {
        this.element.addEventListener('dragstart', evt => {
            evt.preventDefault();
        });

        this.element.addEventListener("zoom_to_bounds", () => {
            this.zoomToMarkerBounds(true);
        });

        this._scriptPromise.then(() => {
            let latLng = new (<any>window).google.maps.LatLng(parseFloat((<any>this.latitude)), parseFloat((<any>this.longitude)));
            let mapTypeId = this.getMapTypeId();

            let options: any = Object.assign({}, this.options, this.config.get('options'), {
                center: latLng,
                zoom: parseInt((<any>this.zoom), 10),
                disableDefaultUI: this.disableDefaultUI,
                mapTypeId: mapTypeId
            });

            this.map = new (<any>window).google.maps.Map(this.element, options);
            if (this.mapLoaded) {
                this.mapLoaded(this.map);
            }
            this._mapResolve();

            // Add event listener for click event
            this.map.addListener('click', (e: Event) => {
                let changeEvent;
                if ((<any>window).CustomEvent) {
                    changeEvent = new CustomEvent('map-click', {
                        detail: e,
                        bubbles: true
                    });
                } else {
                    changeEvent = document.createEvent('CustomEvent');
                    changeEvent.initCustomEvent('map-click', true, true, { data: e });
                }

                this.element.dispatchEvent(changeEvent);
                this.eventAggregator.publish(CLICK, e);
            });

            /**
             * As a proxy for the very noisy bounds_changed event, we'll
             * listen to these two instead:
             *
             * dragend */
            this.map.addListener('dragend', () => {
                this.sendBoundsEvent();
            });
            /* zoom_changed */
            this.map.addListener('zoom_changed', () => {
                this.sendBoundsEvent();
            });
        });
    }

    /**
     * Send the map bounds as an EA event
     *
     * The `bounds` object is an instance of `LatLngBounds`
     * See https://developers.google.com/maps/documentation/javascript/reference#LatLngBounds
     */
    sendBoundsEvent() {
        let bounds = this.map.getBounds();
        if (bounds) {
            this.eventAggregator.publish(BOUNDSCHANGED, bounds);
        }
    }

    /**
     * Send after the api is loaded
     * */
    sendApiLoadedEvent() {
        this.eventAggregator.publish(APILOADED, this._scriptPromise);
    }

    /**
     * Render a marker on the map and add it to collection of rendered markers
     *
     * @param marker
     *
     */
    renderMarker(marker: LatLongMarker): Promise<void> {
        let markerLatLng = new (<any>window).google.maps.LatLng(parseFloat(<string>marker.latitude), parseFloat(<string>marker.longitude));

        return this._mapPromise.then(() => {
            // Create the marker
            this.createMarker({
                map: this.map,
                position: markerLatLng
            }).then((createdMarker: any) => {
                /* add event listener for click on the marker,
                 * the event payload is the marker itself */
                createdMarker.addListener('click', () => {
                    if (!createdMarker.infoWindow) {
                        this.eventAggregator.publish(MARKERCLICK, createdMarker);
                    } else {
                        createdMarker.infoWindow.open(this.map, createdMarker);
                    }
                });

                /*add event listener for hover over the marker,
                 *the event payload is the marker itself*/
                createdMarker.addListener('mouseover', () => {
                    this.eventAggregator.publish(MARKERMOUSEOVER, createdMarker);
                    createdMarker.setZIndex((<any>window).google.maps.Marker.MAX_ZINDEX + 1);
                });

                createdMarker.addListener('mouseout', () => {
                    this.eventAggregator.publish(MARKERMOUSEOUT, createdMarker);
                });

                createdMarker.addListener('dblclick', () => {
                    this.map.setZoom(15);
                    this.map.panTo(createdMarker.position);
                });

                // Set some optional marker properties if they exist
                if (marker.icon) {
                    createdMarker.setIcon(marker.icon);
                }

                if (marker.label) {
                    createdMarker.setLabel(marker.label);
                }

                if (marker.title) {
                    createdMarker.setTitle(marker.title);
                }

                if (marker.draggable) {
                    createdMarker.setDraggable(marker.draggable);
                }

                if (marker.infoWindow) {
                    createdMarker.infoWindow = new (<any>window).google.maps.InfoWindow({
                        content: marker.infoWindow.content,
                        pixelOffset: marker.infoWindow.pixelOffset,
                        position: marker.infoWindow.position,
                        maxWidth: marker.infoWindow.maxWidth
                    });
                    createdMarker.infoWindow.addListener('domready', () => {
                        this.eventAggregator.publish(INFOWINDOWDOMREADY, createdMarker.infoWindow);
                    });
                }

                // Allows arbitrary data to be stored on the marker
                if (marker.custom) {
                    createdMarker.custom = marker.custom;
                }

                // Add it the array of rendered markers
                this._renderedMarkers.push(createdMarker);
            });
        });
    }

    /**
     * Geocodes an address, once the Google Map script
     * has been properly loaded and promise instantiated.
     *
     * @param address string
     * @param geocoder any
     *
     */
    geocodeAddress(address: string) {
        this.geocode(address).then(firstResult => {
            this.setCenter(firstResult.geometry.location);
            this.createMarker({
                map: this.map,
                position: firstResult.geometry.location
            }).then((createdMarker: any) => {
                this._locationByAddressMarkers.push(createdMarker);
                this.eventAggregator.publish(LOCATIONADDED, Object.assign(createdMarker, { placeId: firstResult.place_id }));
            });
        }).catch(console.info);
    }

    /**
     * Geocodes Address and returns the coordinates once the google map has been properly initialized
     *
     * @param address string
     *
     */
    addressMarkerToMarker(marker: AddressMarker): Promise<LatLongMarker> {
        return this.geocode(marker.address).then(firstResults => {
            return {
                ... marker,
                latitude: firstResults.geometry.location.lat(),
                longitude: firstResults.geometry.location.lng(),
            };
        }).catch(console.info);
    }

    /**
     * Geocodes Address and returns the firstresults object after google maps has initialized
     *
     * @param address string
     *
     */
    private geocode(address: string): Promise<any> {
        return this._mapPromise.then(() => {
            return new Promise((resolve, reject) => {
                this.geocoder.geocode({ 'address': address }, (results: any, status: string) => {
                    if (status !== (<any>window).google.maps.GeocoderStatus.OK) {
                        reject(new Error(`Failed to geocode address '${address}' with status: ${status}`));
                    }
                    resolve(results[0]);
                });
            });
        });
    }

    private get geocoder() {
        if (!this._geocoder) {
            this._geocoder = new (<any>window).google.maps.Geocoder;
        }
        return this._geocoder;
    }

    /**
     * Get Current Position
     *
     * Get the users current coordinate info from their browser
     *
     */
    getCurrentPosition(): any {
        if (navigator.geolocation) {
            return navigator.geolocation.getCurrentPosition(position => Promise.resolve(position), evt => Promise.reject(evt));
        }

        return Promise.reject('Browser Geolocation not supported or found.');
    }

    setOptions(options: any) {
        if (!this.map) {
            return;
        }

        this.map.setOptions(options);
    }

    createMarker(options: any) {
        return this._scriptPromise.then(() => {
            return Promise.resolve(new (<any>window).google.maps.Marker(options));
        });
    }

    getCenter() {
        this._mapPromise.then(() => {
            return Promise.resolve(this.map.getCenter());
        });
    }

    setCenter(latLong: any) {
        this._mapPromise.then(() => {
            this.map.setCenter(latLong);
            this.sendBoundsEvent();
        });
    }

    updateCenter() {
        this._mapPromise.then(() => {
            let latLng = new (<any>window).google.maps.LatLng(parseFloat((<any>this.latitude)), parseFloat((<any>this.longitude)));
            this.setCenter(latLng);
        });
    }

    addressChanged(newValue: any) {
        this._mapPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                this.geocodeAddress(newValue);
            });
        });
    }

    latitudeChanged() {
        this._mapPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                this.updateCenter();
            });
        });
    }

    longitudeChanged() {
        this._mapPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                this.updateCenter();
            });
        });
    }

    zoomChanged(newValue: any) {
        this._mapPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                let zoomValue = parseInt(newValue, 10);
                this.map.setZoom(zoomValue);
            });
        });
    }

    /**
     * Observing changes in the entire markers object. This is critical in case the user sets marker to a new empty Array,
     * where we need to resubscribe Observers and delete all previously rendered markers.
     *
     * @param newValue
     */
    markersChanged(newValue: Marker[]) {
        // If there was a previous subscription
        if (this._markersSubscription !== null) {
            // Dispose of the subscription
            this._markersSubscription.dispose();

            // Remove all the currently rendered markers
            for (let marker of this._renderedMarkers) {
                marker.setMap(null);
            }

            // And empty the renderMarkers collection
            this._renderedMarkers = [];
        }

        // Add the subcription to markers
        this._markersSubscription = this.bindingEngine
            .collectionObserver(this.markers)
            .subscribe((splices) => { this.markerCollectionChange(splices); });

        // Render all markers again
        this._mapPromise.then(() => {
            Promise.all<LatLongMarker>(
                newValue.map(marker => {
                    if (isAddressMarker(marker) && !isLatLongMarker(marker)) {
                        return this.addressMarkerToMarker(marker);
                    } else {
                        return marker;
                    }
                })
            ).then(validMarkers => {
                // Addresses that fail to parse return undefined (because the error is caught earlier in the promise chain)
                this.validMarkers = validMarkers.filter(marker => typeof marker !== 'undefined');
                return Promise.all(this.validMarkers.map(this.renderMarker.bind(this)));
            }).then(() => {
                /**
                 * We queue up a task to update the bounds, because in the case of multiple bound properties changing all at once,
                 * we need to let Aurelia handle updating the other properties before we actually trigger a re-render of the map
                 */
                this.taskQueue.queueTask(() => {
                    this.zoomToMarkerBounds();
                });
            });
        });
    }

    /**
     * Handle the change to the marker collection. Collection observer returns an array of splices which contains
     * information about the change to the collection.
     *
     * @param splices
     */
    markerCollectionChange(splices: any) {
        if (!splices.length) {
            // Collection changed but the splices didn't
            return;
        }

        for (let splice of splices) {
            if (splice.removed.length) {
                // Iterate over all the removed markers
                for (let removedObj of splice.removed) {
                    // Iterate over all the rendered markers to find the one to remove
                    for (let markerIndex in this._renderedMarkers) {
                        if (this._renderedMarkers.hasOwnProperty(markerIndex)) {
                            let renderedMarker = this._renderedMarkers[markerIndex];

                            // Check if the latitude/longitude matches - cast to string of float precision (1e-12)
                            if (renderedMarker.position.lat().toFixed(12) === removedObj.latitude.toFixed(12) &&
                                renderedMarker.position.lng().toFixed(12) === removedObj.longitude.toFixed(12)) {
                                // Set the map to null;
                                renderedMarker.setMap(null);

                                // Splice out this rendered marker as well
                                this._renderedMarkers.splice((<any>markerIndex), 1);
                                break;
                            }
                        }
                    }
                }
            }

            // Add the new markers to the map
            if (splice.addedCount) {
                let addedMarkers = this.markers.slice(splice.index, splice.addedCount);

                for (let addedMarker of addedMarkers) {
                    this.renderMarker(addedMarker);
                }
            }
        }

        /**
         * We queue up a task to update the bounds, because in the case of multiple bound properties changing all at once,
         * we need to let Aurelia handle updating the other properties before we actually trigger a re-render of the map
         */
        this.taskQueue.queueTask(() => {
            this.zoomToMarkerBounds();
        });
    }

    zoomToMarkerBounds(force = false) {
        if (typeof force === 'undefined') {
            force = false;
        }

        // Unless forced, if there's no markers, or not auto update bounds
        if (!force && (!this.validMarkers.length || !this.autoUpdateBounds)) {
            return;
        }

        this._mapPromise.then(() => {
            let bounds = new (<any>window).google.maps.LatLngBounds();

            for (let marker of this.validMarkers) {
                // extend the bounds to include each marker's position
                let markerLatLng = new (<any>window).google.maps.LatLng(parseFloat(<string>marker.latitude), parseFloat(<string>marker.longitude));
                bounds.extend(markerLatLng);
            }

            this.map.fitBounds(bounds);
            let listener = google.maps.event.addListener(this.map, 'idle', () => {
                if (this.map.getZoom() > this.zoom) {
                    this.map.setZoom(this.zoom);
                }
                
                google.maps.event.removeListener(listener);
            });
        });
    }

    getMapTypeId() {
        if (this.mapType.toUpperCase() === 'HYBRID') {
            return (<any>window).google.maps.MapTypeId.HYBRID;
        } else if (this.mapType.toUpperCase() === 'SATELLITE') {
            return (<any>window).google.maps.MapTypeId.SATELLITE;
        } else if (this.mapType.toUpperCase() === 'TERRAIN') {
            return (<any>window).google.maps.MapTypeId.TERRAIN;
        }

        return (<any>window).google.maps.MapTypeId.ROADMAP;
    }

    error() {
        logger.error.apply(logger, arguments);
    }

    resize() {
        this._mapPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                (<any>window).google.maps.event.trigger(this.map, 'resize');
            });
        });
    }
    /*************************************************************************
     * Google Maps Drawing Manager
     * The below methods are related to the drawing manager, and exposing some
     * of the Google Maps Drawing API out
     *************************************************************************/

    /**
     * Initialize the drawing manager
     * 
     * @param options - the option object passed into the drawing manager
     */
    initDrawingManager(options: any = {}) {
        return this._mapPromise.then(() => {
            // If its been initialized, we don't need to do so anymore
            if (this.drawingManager) return Promise.resolve();
            // Set the config defaults, and override if we were given any configs
            const config = Object.assign({}, {
                drawingMode: this.getOverlayType(this.drawMode),
                drawingControl: this.drawEnabled
            }, options);
            this.drawingManager = new (<any>window).google.maps.drawing.DrawingManager(config);

            // Add Event listeners and forward them to as a custom event on the
            // element and to the Event Aggregator
            this.drawingManager.addListener('overlaycomplete', evt => {
                let changeEvent;
                // Add the encoded polyline to the event
                Object.assign(evt, { encode: this.encodePath(evt.overlay.getPath()) });
                if ((<any>window).CustomEvent) {
                    changeEvent = new CustomEvent('map-overlay-complete', {
                        detail: evt,
                        bubbles: true
                    });
                } else {
                    changeEvent = document.createEvent('CustomEvent');
                    changeEvent.initCustomEvent('map-overlay-complete', true, true, { data: evt });
                }

                this.element.dispatchEvent(changeEvent);
                this.eventAggregator.publish(OVERLAYCOMPLETE, evt);
            });
            return Promise.resolve();
        });
    }

    /**
     * Destroy the drawing manager when no longer required
     */
    destroyDrawingManager() {
        // Has not been initialized or has been destroyed, just ignore
        if (!this.drawingManager) return;
        // Remove the map and then remove the reference
        this.drawingManager.setMap(null);
        this.drawingManager = null;
    }

    /**
     * Get the given constant that Google's library uses. Defaults to MARKER
     * @param type 
     */
    getOverlayType(type: any = '') {
        switch (type.toUpperCase()) {
            case 'POLYGON':
                return (<any>window).google.maps.drawing.OverlayType.POLYGON;
            case 'POLYLINE':
                return (<any>window).google.maps.drawing.OverlayType.POLYLINE;
            case 'RECTANGLE':
                return (<any>window).google.maps.drawing.OverlayType.RECTANGLE;
            case 'CIRCLE':
                return (<any>window).google.maps.drawing.OverlayType.CIRCLE;
            case 'MARKER':
                return (<any>window).google.maps.drawing.OverlayType.MARKER;
            default:
                    return null;
        }
    }

    /**
     * Update the editing state, called by aurelia binding
     * @param newval 
     */
    drawEnabledChanged(newval: any, oldval: any) {
        this.initDrawingManager()
            .then(() => {
                if (newval && !oldval) {
                    this.drawingManager.setMap(this.map);
                } else if (oldval && !newval) {
                    this.drawingManager.setMap(null);
                }
            });
    }

    /**
     * Update the drawing mode, called by aurelia binding
     * @param newval 
     */
    drawModeChanged(newval: any = '') {
        this.initDrawingManager()
            .then(() => {
                this.drawingManager.setOptions({
                    drawingMode: this.getOverlayType(newval)
                });
            });
    }

    /*************************************************************************
     * POLYLINE ENCODING
     *************************************************************************/

    /**
     * Encode the given path to be a Polyline encoded string
     * more info: https://developers.google.com/maps/documentation/utilities/polylineutility
     * @param path
     */
    encodePath(path: any = []) {
        return (<any>window).google.maps.geometry.encoding.encodePath(path);
    }

    /**
     * Decode the given Polyline encoded string to be an arry of Paths
     * more info: https://developers.google.com/maps/documentation/utilities/polylineutility
     * @param polyline
     */
    decodePath(polyline: string) {
        return (<any>window).google.maps.geometry.encoding.decodePath(polyline);
    }

    /*************************************************************************
     * POLYGONS
     *************************************************************************/

    /**
     * Render a single polygon on the map and add it to the _renderedPolygons
     * array.
     * @param paths - paths defining a polygon or a string
     */
    renderPolygon(paths: any = [])  {
        // If the path given was still a string, try and get a path definition
        if (typeof paths === 'string') {
            paths = this.decodePath(paths);
        }
        let polygon = new (<any>window).google.maps.Polygon({
            paths
        });

        polygon.setMap(this.map);
        this._renderedPolygons.push(polygon);
    }

    /**
     * Observing changes in the entire polygons object. This is critical in
     * case the user sets polygons to a new empty Array, where we need to
     * resubscribe Observers and delete all previously rendered polygons.
     *
     * @param newValue
     */
    polygonsChanged(newValue: any) {
        // If there was a previous subscription
        if (this._polygonsSubscription !== null) {
            // Dispose of the subscription
            this._polygonsSubscription.dispose();

            // Remove all the currently rendered polygons
            for (let polygon of this._renderedPolygons) {
                polygon.setMap(null);
            }

            // And empty the renderMarkers collection
            this._renderedPolygons = [];
        }

        // Add the subcription to markers
        this._polygonsSubscription = this.bindingEngine
            .collectionObserver(this.polygons)
            .subscribe((splices) => { this.polygonCollectionChange(splices); });

        // Render all markers again
        this._mapPromise.then(() => {
            Promise.all(
                newValue.map(polygon => {
                    if (typeof polygon === 'string') {
                        return this.decodePath(polygon);
                    }
                    return polygon;
                })
            ).then(polygons => {
                return Promise.all(polygons.map(this.renderPolygon.bind(this)));
            }).then(() => {
                /**
                 * We queue up a task to update the bounds, because in the case of multiple bound properties changing all at once,
                 * we need to let Aurelia handle updating the other properties before we actually trigger a re-render of the map
                 */
                this.taskQueue.queueTask(() => {
                    this.zoomToMarkerBounds();
                });
            });
        });
    }

    /**
     * Handle the change to the polygon collection. Collection observer returns an array of splices which contains
     * information about the change to the collection.
     *
     * @param splices
     */
    polygonCollectionChange(splices: any) {
        if (!splices.length) {
            // Collection changed but the splices didn't
            return;
        }

        for (let splice of splices) {
            if (splice.removed.length) {
                // Iterate over all the removed markers
                for (let removedObj of splice.removed) {
                    // Iterate over all the rendered markers to find the one to remove
                    for (let polygonIndex in this._renderedPolygons) {
                        if (this._renderedPolygons.hasOwnProperty(polygonIndex)) {
                            let renderedPolygon = this._renderedPolygons[polygonIndex];

                            // Get string representation
                            let strRendered, strRemoved;
                            if (typeof renderedPolygon === 'object') {
                                strRendered = this.encodePath(renderedPolygon);
                            } else {
                                strRendered = renderedPolygon;
                            }
                            if (typeof removedObj === 'object') {
                                strRemoved = this.encodePath(removedObj);
                            } else {
                                strRemoved = removedObj;
                            }

                            // Check based on string representation
                            if (strRendered === strRemoved) {
                                // Set the map to null;
                                renderedPolygon.setMap(null);

                                // Splice out this rendered marker as well
                                this._renderedPolygons.splice((<any>polygonIndex), 1);
                                break;
                            }
                        }
                    }
                }
            }

            // Add the new polygons to the map
            if (splice.addedCount) {
                let addedPolygons = this.polygons.slice(splice.index, splice.index + splice.addedCount);
                for (let addedPolygon of addedPolygons) {
                    this.renderPolygon(addedPolygon);
                }
            }
        }

        /**
         * We queue up a task to update the bounds, because in the case of multiple bound properties changing all at once,
         * we need to let Aurelia handle updating the other properties before we actually trigger a re-render of the map
         */
        this.taskQueue.queueTask(() => {
            this.zoomToMarkerBounds();
        });
    }
}
