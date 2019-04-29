import React  from 'react'
import hoistNonReactStatic from 'hoist-non-react-statics'

type Listener = () => Promise<void>

export class Container<S extends object> {
  state: S
  _listeners: Listener[] = []

  setState = (updater?: Partial<S> | ((prevState: S) => Partial<S>), callback?: (state?: S) => void) => {
    let nextState: Partial<S>
    if (typeof updater === 'function') {
      nextState = (updater as (prevState: S) => Partial<S>)(this.state)
    } else {
      nextState = updater
    }

    if (nextState === null) {
      if (callback) callback(this.state)
      return Promise.resolve()
    }

    if (nextState && nextState !== this.state) {
      this.state = {...this.state, ...nextState}
    }
    
    let promises = this._listeners.map(listener => listener())
    return Promise.all(promises).then(() => {
      if (callback && typeof callback === 'function') {
        callback(this.state)
      }
    })
  }

  subscribe = (fn: Listener) => this._listeners.unshift(fn)

  unsubscribe = (fn: Listener) => this._listeners = this._listeners.filter(f => f !== fn)
}

interface ContainerClass<S extends object, TContainer extends Container<S> = Container<S>> {
  new (...args: any[]): TContainer
}

type ContainerType<S extends object> = Container<S> | ContainerClass<S>

type ContainersType = [ContainerType<object>, ...ContainerType<object>[]]

type ContainersMap = Map<ContainerClass<object>, Container<object>>

type MapContainersType<TContainers extends ContainersType> = {
  [K in keyof TContainers]: TContainers[K] extends ContainerClass<object, infer C> ? C : 
    TContainers[K] extends Container<object> ? TContainers[K] : any
}

type Containers<
  TContainers extends ContainerType<object> | ContainersType
> = TContainers extends ContainerClass<object, infer C> ? [C] : 
    TContainers extends Container<object> ? [TContainers] :
    TContainers extends ContainersType ? MapContainersType<TContainers> :
    any[]

interface SubscribeProps<TContainers extends ContainersType> {
  to: TContainers
  children: (...instances: Containers<TContainers>) => React.ReactNode
}

const Context = React.createContext<ContainersMap>(null)

export class Subscribe<TContainers extends ContainersType> extends React.Component<SubscribeProps<TContainers>> {
  _instances = []
  _unmounted = false

  _unsubscribe = () => this._instances.forEach(container => container.unsubscribe(this.onUpdate))
  
  _createInstances = (ctx: ContainersMap, containers: TContainers) => {
    if (!ctx) throw new Error('You must wrap your <Subscribe> components with a <Provider>')

    this._unsubscribe()
    this._instances = containers.map(item => {
      let instance: ContainerType<object>
      if (typeof item === 'object' && item instanceof Container) {
        instance = item
      } else {
        instance = ctx.get(item)
        if (!instance) {
          instance = new item()
          ctx.set(item, instance)
        }
      }
      instance.subscribe(this.onUpdate)
      return instance
    })

    return this._instances as Containers<TContainers>
  }

  onUpdate: Listener = async () => new Promise(resolve => !this._unmounted ? this.setState({}, resolve) : resolve())

  componentWillUnmount() {
    this._unmounted = true
    this._unsubscribe()
  }

  render() {
    const { to, children } = this.props
    return (
      <Context.Consumer>
        {ctx => children.apply(null, this._createInstances(ctx, to))}
      </Context.Consumer>
    )
  }
}

interface ProviderProps {
  inject?: [Container<object>, ...Container<object>[]]
  children: React.ReactNode
}

export const Provider = ({inject, children}: ProviderProps) => {
  return (
    <Context.Consumer>
      {ctx => {
        let map = new Map(ctx)
        if (inject) inject.forEach(instance => map.set(instance.constructor as ContainerClass<object>, instance))
        return (
          <Context.Provider value={map}>
            {children}
          </Context.Provider>
        )
      }}
    </Context.Consumer>
  )
}

type MapStateToProps<
  TContainers extends ContainerType<object> | ContainersType
> = (...containers: Containers<TContainers>) => object

export const unstated = <
  TContainers extends ContainerType<object> | ContainersType
>(containers: TContainers, mapStateToProps?: MapStateToProps<TContainers>) => 
  <P extends object>(Component: React.ComponentType<P>) => {
    class UnstatedComponent extends React.Component<P> {
      render() {
        return (
          <Subscribe to={(Array.isArray(containers) ? containers: [containers]) as ContainersType}>{
            (...containers) => {
              let injectProps = {}
              if (mapStateToProps === undefined) {
                injectProps = containers.reduce((m, c) => {
                  let n = c.constructor.name
                  n = n.charAt(0).toLowerCase() + n.slice(1)
                  m[n] = c
                  return m
                }, {})
              } else {
                injectProps = mapStateToProps(...containers as Containers<TContainers>)
              }
              return <Component {...this.props} {...injectProps}/>
            }
          }</Subscribe>
        )
      }
    }

  (UnstatedComponent as React.ComponentType).displayName =
    `Unstated(${Component.displayName || Component.name || 'Component'})`

  hoistNonReactStatic(UnstatedComponent, Component)

  return UnstatedComponent as React.ComponentType<any>
}

export default unstated
