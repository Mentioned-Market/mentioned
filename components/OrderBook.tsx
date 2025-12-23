'use client'

interface Order {
  price: number
  amount: number
  total: number
}

interface OrderBookProps {
  buyOrders: Order[]
  sellOrders: Order[]
}

export default function OrderBook({ buyOrders, sellOrders }: OrderBookProps) {
  return (
    <div className="border-4 border-white bg-black">
      <div className="border-b-4 border-white p-4">
        <h3 className="text-white font-mono text-xl uppercase">ORDER BOOK [PREVIEW]</h3>
        <p className="text-white/70 font-mono text-xs mt-1">
          *Simulated orders - AMM pricing in production
        </p>
      </div>
      
      <div className="grid grid-cols-2 divide-x-4 divide-white">
        {/* Buy Orders */}
        <div className="p-4">
          <div className="text-green-500 font-mono text-sm font-bold mb-3 uppercase">BUY ORDERS</div>
          <div className="space-y-1 font-mono text-xs">
            <div className="grid grid-cols-3 gap-2 text-white/50 mb-2">
              <span>PRICE</span>
              <span className="text-right">AMOUNT</span>
              <span className="text-right">TOTAL</span>
            </div>
            {buyOrders.map((order, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 text-white hover:bg-white/10">
                <span className="text-green-500">${order.price.toFixed(2)}</span>
                <span className="text-right">{order.amount}</span>
                <span className="text-right">${order.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sell Orders */}
        <div className="p-4">
          <div className="text-red-500 font-mono text-sm font-bold mb-3 uppercase">SELL ORDERS</div>
          <div className="space-y-1 font-mono text-xs">
            <div className="grid grid-cols-3 gap-2 text-white/50 mb-2">
              <span>PRICE</span>
              <span className="text-right">AMOUNT</span>
              <span className="text-right">TOTAL</span>
            </div>
            {sellOrders.map((order, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 text-white hover:bg-white/10">
                <span className="text-red-500">${order.price.toFixed(2)}</span>
                <span className="text-right">{order.amount}</span>
                <span className="text-right">${order.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

